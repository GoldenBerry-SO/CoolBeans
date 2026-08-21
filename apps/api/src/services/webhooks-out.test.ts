// ABOUTME: Outbound webhooks (issue #108) — signed deliveries of licence lifecycle events.
// ABOUTME: Delivery rides the outbox; a vendor's dead server must never touch issuance.

import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { licenses, products } from '@coolbeans/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { rawExec, rawQuery } from '../test/pg.js';
import { createProduct, issueKey, post, signUp } from '../test/seed.js';
import { drainOutbox } from './outbox.js';
import { pruneWebhookDeliveries } from './prune.js';
import { emitWebhookEvent, WEBHOOK_EVENT_TYPES } from './webhooks-out.js';

let h: TestHarness;
let server: Server | undefined;
let received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }>;
let respondWith = 200;
let redirectTo: string | null = null;

/** A real local HTTP server: the repo rule is real transports, never mocks. */
async function listen(): Promise<string> {
	received = [];
	respondWith = 200;
	redirectTo = null;
	server = createServer((req, res) => {
		let body = '';
		req.on('data', (chunk) => {
			body += chunk;
		});
		req.on('end', () => {
			received.push({ headers: req.headers, body });
			if (redirectTo) {
				res.statusCode = 307;
				res.setHeader('Location', redirectTo);
				res.end();
				return;
			}
			res.statusCode = respondWith;
			res.end();
		});
	});
	await new Promise<void>((resolve) => {
		server?.listen(0, '127.0.0.1', resolve);
	});
	const address = server?.address();
	if (!address || typeof address === 'string') throw new Error('no address');
	return `http://127.0.0.1:${address.port}/hooks`;
}

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clem.test',
	});
});

afterEach(async () => {
	await new Promise<void>((resolve) => {
		if (!server) return resolve();
		server.close(() => resolve());
		server = undefined;
	});
});

async function addEndpoint(
	url: string,
	events: string[],
	product?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
	const res = await h.app.request('/admin/webhooks/endpoints', {
		method: 'POST',
		headers: h.adminHeaders,
		body: JSON.stringify({ url, events, ...(product ? { product } : {}) }),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('registering endpoints', () => {
	it('returns the signing secret exactly once and never again', async () => {
		const r = await addEndpoint(await listen(), ['license.issued']);
		expect(r.status).toBe(200);
		const secret = (r.body.endpoint as { secret: string }).secret;
		expect(secret).toMatch(/^cbw_/);

		// The stored copy is encrypted, and the list never carries a secret.
		const [row] = await rawQuery<{ secret: string }>('SELECT secret FROM webhook_endpoints');
		expect(row.secret).not.toContain(secret);
		const list = await h.app.request('/admin/webhooks/endpoints', { headers: h.adminHeaders });
		expect(JSON.stringify(await list.json())).not.toContain(secret);
	});

	it('refuses an unknown event type by name', async () => {
		const r = await addEndpoint(await listen(), ['license.minted']);
		expect(r.status).toBeGreaterThanOrEqual(400);
		expect(JSON.stringify(r.body)).toMatch(/license\.minted/);
	});

	it('self-host allows loopback receivers — the operator owns that network', async () => {
		const r = await addEndpoint('http://127.0.0.1:9999/h', ['license.issued']);
		expect(r.status, JSON.stringify(r.body)).toBe(200);
	});
});

describe('delivering events', () => {
	it('signs and delivers license.issued, verifiable with the documented recipe', async () => {
		const url = await listen();
		const created = await addEndpoint(url, ['license.issued']);
		const secret = (created.body.endpoint as { secret: string }).secret;

		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'b@x.test',
			kind: 'perpetual',
		});
		await drainOutbox(h.deps);

		expect(received).toHaveLength(1);
		const delivery = received[0];
		expect(delivery.headers['x-coolbeans-event']).toBe('license.issued');

		// The documented verification recipe: HMAC-SHA256(secret, `${t}.${body}`).
		const signature = String(delivery.headers['x-coolbeans-signature']);
		const t = signature.match(/t=(\d+)/)?.[1];
		const v1 = signature.match(/v1=([0-9a-f]+)/)?.[1];
		expect(t).toBeTruthy();
		const expected = createHmac('sha256', secret).update(`${t}.${delivery.body}`).digest('hex');
		expect(v1).toBe(expected);

		// The payload carries the §9 licence object plus event metadata.
		const parsed = JSON.parse(delivery.body) as {
			event: { type: string; created_at: string };
			license: { key: string; status: string; kind: string; product: string };
		};
		expect(parsed.event.type).toBe('license.issued');
		expect(parsed.license.key).toBe(key);
		expect(parsed.license.product).toBe('clementine');
	});

	it('only sends subscribed event types', async () => {
		const url = await listen();
		await addEndpoint(url, ['license.disabled']);
		await issueKey(h.app, { product: 'clementine', email: 'b@x.test', kind: 'perpetual' });
		await drainOutbox(h.deps);
		expect(received).toHaveLength(0);
	});

	it('delivers activation.created when a customer activates', async () => {
		const url = await listen();
		await addEndpoint(url, ['activation.created']);
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'b@x.test',
			kind: 'perpetual',
		});
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'their-mac' });
		await drainOutbox(h.deps);
		expect(received).toHaveLength(1);
		expect(received[0].headers['x-coolbeans-event']).toBe('activation.created');
	});

	it('retries a failed delivery and records the trail, without touching issuance', async () => {
		const url = await listen();
		await addEndpoint(url, ['license.issued']);
		respondWith = 500;
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'b@x.test',
			kind: 'perpetual',
		});
		expect(key).toBeTruthy(); // the key issued despite the dead receiver
		await drainOutbox(h.deps);

		const [after1] = await rawQuery<{ status: string; attempts: number; last_error: string }>(
			'SELECT status, attempts, last_error FROM webhook_deliveries',
		);
		expect(after1.attempts).toBe(1);
		expect(after1.status).toBe('pending');
		expect(after1.last_error).toContain('500');

		// The receiver recovers; the backoff window passes; the retry lands.
		respondWith = 200;
		h.clock.advance(5 * 60_000);
		await drainOutbox(h.deps);
		const [after2] = await rawQuery<{ status: string }>('SELECT status FROM webhook_deliveries');
		expect(after2.status).toBe('delivered');
		expect(
			received.filter((r) => r.headers['x-coolbeans-event'] === 'license.issued'),
		).toHaveLength(2);
	});

	it('a reaped floating lease emits activation.deactivated like a manual free', async () => {
		const { reapFloatingLeases } = await import('./sweep.js');
		const url = await listen();
		await addEndpoint(url, ['activation.deactivated']);
		await createProduct(h.app, {
			slug: 'floaty',
			name: 'Floaty',
			key_prefix: 'FLT',
			email_from: 'r@clem.test',
			activation_model: 'floating',
			floating_lease_minutes: 30,
		});
		const key = await issueKey(h.app, { product: 'floaty', email: 'b@x.test', kind: 'perpetual' });
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'lapsing' });
		h.clock.advance(31 * 60_000);
		expect(await reapFloatingLeases(h.deps)).toBe(1);
		await drainOutbox(h.deps);
		expect(received).toHaveLength(1);
		expect(received[0].headers['x-coolbeans-event']).toBe('activation.deactivated');
		expect(JSON.parse(received[0].body)).toMatchObject({ reason: 'lease_expired' });
	});

	it('a disabled endpoint stops receiving immediately', async () => {
		const url = await listen();
		const created = await addEndpoint(url, ['license.issued']);
		const id = (created.body.endpoint as { id: number }).id;
		await h.app.request(`/admin/webhooks/endpoints/${id}`, {
			method: 'DELETE',
			headers: h.adminHeaders,
		});
		await issueKey(h.app, { product: 'clementine', email: 'b@x.test', kind: 'perpetual' });
		await drainOutbox(h.deps);
		expect(received).toHaveLength(0);
	});
});

describe('tenancy', () => {
	const cloud: Partial<Config> = {
		billing: { stripeSecretKey: 'sk_billing', proPriceId: 'price_pro' },
		logMagicCodes: true,
	};

	it("never delivers one account's events to another's endpoint", async () => {
		const ch = await makeHarness({ config: cloud });
		const alice = await signUp(ch.app, ch.logger, 'alice@alpha.test', 'alpha');
		const bob = await signUp(ch.app, ch.logger, 'bob@beta.test', 'beta');
		await createProduct(
			ch.app,
			{ slug: 'alpha-app', name: 'Alpha', key_prefix: 'ALPHA', email_from: 'a@alpha.test' },
			alice,
		);
		// Bob subscribes to everything; Alice's issuance must not reach him. A public URL:
		// cloud refuses loopback, and nothing gets delivered anyway — the row is the test.
		const res = await ch.app.request('/admin/webhooks/endpoints', {
			method: 'POST',
			headers: bob,
			body: JSON.stringify({ url: 'https://bob.example.com/hooks', events: ['license.issued'] }),
		});
		expect(res.status).toBe(200);
		await issueKey(ch.app, { product: 'alpha-app', email: 'x@y.test', kind: 'perpetual' }, alice);
		const rows = await rawQuery<{ id: number }>('SELECT id FROM webhook_deliveries');
		expect(rows).toHaveLength(0);
	});

	it('cloud refuses loopback and private-network URLs', async () => {
		const ch = await makeHarness({ config: cloud });
		const alice = await signUp(ch.app, ch.logger, 'alice@alpha.test', 'alpha');
		for (const url of [
			'http://localhost:9999/h',
			'http://127.0.0.1/h',
			'http://10.0.0.5/h',
			'http://192.168.1.1/h',
			'http://169.254.169.254/latest/meta-data',
			// The IPv6 shapes Codex caught sliding past the v4-only guard.
			'http://[::1]/h',
			'http://[fd00::1]/h',
			'http://[fe80::1]/h',
			'http://[::ffff:10.0.0.5]/h',
		]) {
			const res = await ch.app.request('/admin/webhooks/endpoints', {
				method: 'POST',
				headers: alice,
				body: JSON.stringify({ url, events: ['license.issued'] }),
			});
			expect(res.status, url).toBeGreaterThanOrEqual(400);
		}
	});
});

describe('buyer in the payload (#143)', () => {
	it('carries buyer.email on every event type, so a consumer never branches', async () => {
		const url = await listen();
		await addEndpoint(url, [...WEBHOOK_EVENT_TYPES]);
		await issueKey(h.app, { product: 'clementine', email: 'buyer@x.test', kind: 'perpetual' });

		// Drive the emitter directly for every type: the six real triggers need six very
		// different set-ups, and what is under test is that the field is unconditional.
		const [license] = await h.deps.db.select().from(licenses);
		const [product] = await h.deps.db.select().from(products);
		// Flush the delivery the issuance above already queued, so the count below is the
		// loop's own six and nothing else.
		await drainOutbox(h.deps);
		received = [];
		for (const type of WEBHOOK_EVENT_TYPES) {
			await emitWebhookEvent(h.deps, { accountId: 1, type, license, product });
		}
		await drainOutbox(h.deps);

		expect(received).toHaveLength(WEBHOOK_EVENT_TYPES.length);
		for (const r of received) {
			const body = JSON.parse(r.body) as { event: { type: string }; buyer?: { email: string } };
			expect(body.buyer?.email, `missing on ${body.event.type}`).toBe('buyer@x.test');
		}
	});

	it('carries the buyer for a manually issued key', async () => {
		// Manual issuance still creates a purchase row, so there is no absent-buyer case.
		const url = await listen();
		await addEndpoint(url, ['license.issued']);
		await issueKey(h.app, { product: 'clementine', email: 'hand@x.test', kind: 'perpetual' });
		await drainOutbox(h.deps);
		expect(JSON.parse(received[0].body).buyer.email).toBe('hand@x.test');
	});

	it('keeps the email out of the public licence object', async () => {
		// The `license` object is the frozen §9 shape and the docs promise it matches what
		// the public API serializes. buyer is assembled in the emitter, never in the shared
		// serializer, so activate and validate must stay clean.
		const url = await listen();
		await addEndpoint(url, ['license.issued']);
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'private@x.test',
			kind: 'perpetual',
		});
		await drainOutbox(h.deps);

		const delivered = JSON.parse(received[0].body) as {
			license: Record<string, unknown>;
			buyer: { email: string };
		};
		expect(delivered.buyer.email).toBe('private@x.test');
		expect(delivered.license).not.toHaveProperty('email');

		const activated = await post(h.app, '/v1/activate', {
			license_key: key,
			instance_name: 'their-mac',
		});
		const validated = await post(h.app, '/v1/validate', {
			license_key: key,
			instance_id: (activated.body as { instance: { id: string } }).instance.id,
		});
		expect(JSON.stringify(validated.body)).not.toContain('private@x.test');
		expect(JSON.stringify(activated.body)).not.toContain('private@x.test');
	});
});

describe('buyer email never rides plaintext on cloud (#143)', () => {
	const cloud: Partial<Config> = {
		billing: { stripeSecretKey: 'sk_billing', proPriceId: 'price_pro' },
		logMagicCodes: true,
	};

	it('refuses an http endpoint on cloud, because the payload carries an email', async () => {
		const ch = await makeHarness({ config: cloud });
		const owner = await signUp(ch.app, ch.logger, 'v@vendor.test', 'vendor');
		await createProduct(
			ch.app,
			{ slug: 'app', name: 'App', key_prefix: 'APP', email_from: 'r@v.test' },
			owner,
		);
		const res = await ch.app.request('/admin/webhooks/endpoints', {
			method: 'POST',
			headers: owner,
			body: JSON.stringify({ url: 'http://hooks.vendor.test/h', events: ['license.issued'] }),
		});
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(JSON.stringify(await res.json())).toMatch(/https/i);
	});

	it('still allows http on self-host, where the operator owns the network', async () => {
		// Same rule as the loopback case: self-host is one operator's own machines.
		const r = await addEndpoint('http://127.0.0.1:9998/h', ['license.issued']);
		expect(r.status, JSON.stringify(r.body)).toBe(200);
	});

	it('sends a null email to a cloud endpoint whose URL is plaintext', async () => {
		// Registration refuses these now, but a row may already exist from before the rule.
		// The buyer object still ships, so no consumer has to branch on its absence; the
		// address just does not travel in the clear.
		const ch = await makeHarness({ config: cloud });
		const owner = await signUp(ch.app, ch.logger, 'v@vendor.test', 'vendor');
		await createProduct(
			ch.app,
			{ slug: 'app', name: 'App', key_prefix: 'APP', email_from: 'r@v.test' },
			owner,
		);
		const register = async (url: string) => {
			const res = await ch.app.request('/admin/webhooks/endpoints', {
				method: 'POST',
				headers: owner,
				body: JSON.stringify({ url, events: ['license.issued'] }),
			});
			expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
		};
		// Registered over https, which is allowed, then downgraded behind our back.
		await register('https://plain.vendor.test/h');
		await register('https://secure.vendor.test/h');
		const local = await listen();
		await rawExec(
			`UPDATE webhook_endpoints SET url = '${local}' WHERE url = 'https://plain.vendor.test/h'`,
		);

		await issueKey(ch.app, { product: 'app', email: 'buyer@x.test', kind: 'perpetual' }, owner);
		await drainOutbox(ch.deps);

		// What actually went over the plaintext connection.
		expect(received).toHaveLength(1);
		expect(JSON.parse(received[0].body).buyer.email).toBeNull();

		// The https endpoint is unreachable in a test, but its body is stored, and that body
		// is what proves the null above is about the scheme and not about losing the email.
		const rows = await rawQuery<{ payload: string }>(
			"SELECT d.payload FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE e.url = 'https://secure.vendor.test/h'",
		);
		expect(JSON.parse(rows[0].payload).buyer.email).toBe('buyer@x.test');
	});
});

describe('redirects are not followed', () => {
	it('refuses to follow a redirect, so the payload cannot be moved elsewhere', async () => {
		// fetch follows redirects by default, which would let a receiver bounce the body,
		// buyer email included, onto http:// or onto a private address the registration
		// checks refused. The delivery fails instead and says why.
		const url = await listen();
		await addEndpoint(url, ['license.issued']);
		redirectTo = `${url}/somewhere-else`;

		await issueKey(h.app, { product: 'clementine', email: 'buyer@x.test', kind: 'perpetual' });
		await drainOutbox(h.deps);

		// One request only. Following the redirect would have produced a second.
		expect(received).toHaveLength(1);
		const [row] = await rawQuery<{ status: string; last_error: string }>(
			'SELECT status, last_error FROM webhook_deliveries',
		);
		expect(row.status).toBe('pending');
		expect(row.last_error).toMatch(/redirect/i);
	});
});

describe('retention (#141)', () => {
	it('an in-flight delivery survives a prune and still delivers afterwards', async () => {
		// The prune skips pending rows, and this is why it has to: the stored payload is the
		// only copy of the body. Delete it and the retry has nothing to send.
		const url = await listen();
		await addEndpoint(url, ['license.issued']);

		respondWith = 500;
		await issueKey(h.app, { product: 'clementine', email: 'b@x.test', kind: 'perpetual' });
		await drainOutbox(h.deps);
		const [pending] = await rawQuery<{ status: string; payload: string }>(
			'SELECT status, payload FROM webhook_deliveries',
		);
		expect(pending.status).toBe('pending');

		// Age it far past the window. A finished delivery this old would go.
		h.clock.advance(60 * 24 * 60 * 60 * 1000);
		expect(await pruneWebhookDeliveries(h.deps)).toBe(0);

		respondWith = 200;
		await drainOutbox(h.deps);
		const [after] = await rawQuery<{ status: string; payload: string }>(
			'SELECT status, payload FROM webhook_deliveries',
		);
		expect(after.status).toBe('delivered');
		// The body that went is the one that was stored, not one rebuilt from now.
		expect(after.payload).toBe(pending.payload);
		expect(received).toHaveLength(2);
	});

	it('a delivery pruned out from under an in-flight job is a clean no-op', async () => {
		// The prune only touches terminal rows, so this needs the delete to land between the
		// worker reading a row and finishing with it. What has to hold is that a vanished row
		// is not an error: the job completes, so there is no retry storm and no second send.
		const url = await listen();
		await addEndpoint(url, ['license.issued']);
		respondWith = 500;
		await issueKey(h.app, { product: 'clementine', email: 'b@x.test', kind: 'perpetual' });
		await drainOutbox(h.deps);
		expect(received).toHaveLength(1);

		await rawExec('DELETE FROM webhook_deliveries');

		// The outbox job still points at the row that is now gone.
		respondWith = 200;
		h.clock.advance(5 * 60_000);
		await drainOutbox(h.deps);

		// No further attempt was made, and the job did not stay pending to try again forever.
		expect(received).toHaveLength(1);
		const outbox = await rawQuery<{ status: string }>(
			"SELECT status FROM outbox WHERE kind = 'deliver_webhook'",
		);
		expect(outbox.every((o) => o.status !== 'pending')).toBe(true);
	});

	it('prunes the same delivery once it is finished', async () => {
		const url = await listen();
		await addEndpoint(url, ['license.issued']);
		await issueKey(h.app, { product: 'clementine', email: 'b@x.test', kind: 'perpetual' });
		await drainOutbox(h.deps);
		const [row] = await rawQuery<{ status: string }>('SELECT status FROM webhook_deliveries');
		expect(row.status).toBe('delivered');

		h.clock.advance(60 * 24 * 60 * 60 * 1000);
		expect(await pruneWebhookDeliveries(h.deps)).toBe(1);
	});
});

describe('per-product endpoint scope (#142)', () => {
	beforeEach(async () => {
		await createProduct(h.app, {
			slug: 'tideglass',
			name: 'TideGlass',
			key_prefix: 'TIDE',
			email_from: 'r@tide.test',
		});
	});

	it('a scoped endpoint hears only its own product', async () => {
		const url = await listen();
		expect((await addEndpoint(url, ['license.issued'], 'clementine')).status).toBe(200);

		// The other product's event must not reach it.
		await issueKey(h.app, { product: 'tideglass', email: 'b@x.test', kind: 'perpetual' });
		await drainOutbox(h.deps);
		expect(received).toHaveLength(0);

		await issueKey(h.app, { product: 'clementine', email: 'b@x.test', kind: 'perpetual' });
		await drainOutbox(h.deps);
		expect(received).toHaveLength(1);
		expect(JSON.parse(received[0].body).license.product).toBe('clementine');
	});

	it('an unscoped endpoint still hears everything, so existing rows keep working', async () => {
		const url = await listen();
		expect((await addEndpoint(url, ['license.issued'])).status).toBe(200);

		await issueKey(h.app, { product: 'clementine', email: 'b@x.test', kind: 'perpetual' });
		await issueKey(h.app, { product: 'tideglass', email: 'b@x.test', kind: 'perpetual' });
		await drainOutbox(h.deps);

		expect(received).toHaveLength(2);
		expect(received.map((r) => JSON.parse(r.body).license.product).sort()).toEqual([
			'clementine',
			'tideglass',
		]);
	});

	it('reports the scope on the endpoint list, and null when unscoped', async () => {
		await addEndpoint('https://a.example.com/h', ['license.issued'], 'tideglass');
		await addEndpoint('https://b.example.com/h', ['license.issued']);

		const res = await h.app.request('/admin/webhooks/endpoints', { headers: h.adminHeaders });
		const { endpoints } = (await res.json()) as {
			endpoints: { url: string; product: string | null }[];
		};
		expect(endpoints.find((e) => e.url.includes('a.example.com'))?.product).toBe('tideglass');
		expect(endpoints.find((e) => e.url.includes('b.example.com'))?.product).toBeNull();
	});

	it('reports the scope the same way on create as on list', async () => {
		// These two shapes drifted once: create answered with a raw product_id while the
		// list answered with a slug, so the console's shared type was quietly wrong.
		const scoped = await addEndpoint('https://a.example.com/h', ['license.issued'], 'tideglass');
		const unscoped = await addEndpoint('https://b.example.com/h', ['license.issued']);

		const scopedEndpoint = scoped.body.endpoint as Record<string, unknown>;
		expect(scopedEndpoint.product).toBe('tideglass');
		expect((unscoped.body.endpoint as Record<string, unknown>).product).toBeNull();
		expect(scopedEndpoint).not.toHaveProperty('productId');
	});

	it('refuses an unknown product slug', async () => {
		const r = await addEndpoint('https://a.example.com/h', ['license.issued'], 'nope');
		expect(r.status).toBe(404);
	});

	it("refuses another account's product with a 404, never a 403", async () => {
		// A 403 would confirm the product exists in someone else's account.
		const cloud: Partial<Config> = {
			billing: { stripeSecretKey: 'sk_billing', proPriceId: 'price_pro' },
			logMagicCodes: true,
		};
		const ch = await makeHarness({ config: cloud });
		const alice = await signUp(ch.app, ch.logger, 'alice@alpha.test', 'alpha');
		const bob = await signUp(ch.app, ch.logger, 'bob@beta.test', 'beta');
		await createProduct(
			ch.app,
			{ slug: 'alpha-app', name: 'Alpha', key_prefix: 'ALPHA', email_from: 'a@alpha.test' },
			alice,
		);

		const res = await ch.app.request('/admin/webhooks/endpoints', {
			method: 'POST',
			headers: bob,
			body: JSON.stringify({
				url: 'https://bob.example.com/h',
				events: ['license.issued'],
				product: 'alpha-app',
			}),
		});
		expect(res.status).toBe(404);
	});

	it('the database refuses a cross-tenant scope, not just the handler', async () => {
		// The handler resolves the slug through the caller's account, so a cross-tenant pair
		// can only arrive from a future writer or a hand-run SQL fix. It would list as
		// unscoped while matching no events, so the endpoint would be silently dead.
		// fk_webhook_endpoints_product is what makes it impossible rather than unlikely.
		const cloud: Partial<Config> = {
			billing: { stripeSecretKey: 'sk_billing', proPriceId: 'price_pro' },
			logMagicCodes: true,
		};
		const ch = await makeHarness({ config: cloud });
		const alice = await signUp(ch.app, ch.logger, 'alice@alpha.test', 'alpha');
		await signUp(ch.app, ch.logger, 'bob@beta.test', 'beta');
		await createProduct(
			ch.app,
			{ slug: 'alpha-app', name: 'Alpha', key_prefix: 'ALPHA', email_from: 'a@alpha.test' },
			alice,
		);

		const [product] = await rawQuery<{ id: number; account_id: number }>(
			"SELECT id, account_id FROM products WHERE slug = 'alpha-app'",
		);
		const [bobAccount] = await rawQuery<{ id: number }>(
			'SELECT id FROM accounts WHERE id <> $1 ORDER BY id LIMIT 1',
			[product.account_id],
		);
		const insert = `INSERT INTO webhook_endpoints (account_id, product_id, url, events, secret)
			VALUES ($1, $2, 'https://bob.example.com/h', '["license.issued"]', 'cbw_test')`;

		await expect(rawQuery(insert, [bobAccount.id, product.id])).rejects.toThrow(
			/fk_webhook_endpoints_product/,
		);

		// The same insert unscoped succeeds, so what was refused is the tenant pair rather
		// than the statement. It also pins the NULL behaviour the composite key relies on.
		await expect(rawQuery(insert, [bobAccount.id, null])).resolves.toBeDefined();
	});
});
