// ABOUTME: Outbound webhooks (issue #108) — signed deliveries of licence lifecycle events.
// ABOUTME: Delivery rides the outbox; a vendor's dead server must never touch issuance.

import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { rawQuery } from '../test/pg.js';
import { createProduct, issueKey, post, signUp } from '../test/seed.js';
import { drainOutbox } from './outbox.js';

let h: TestHarness;
let server: Server | undefined;
let received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }>;
let respondWith = 200;

/** A real local HTTP server: the repo rule is real transports, never mocks. */
async function listen(): Promise<string> {
	received = [];
	respondWith = 200;
	server = createServer((req, res) => {
		let body = '';
		req.on('data', (chunk) => {
			body += chunk;
		});
		req.on('end', () => {
			received.push({ headers: req.headers, body });
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
): Promise<{ status: number; body: Record<string, unknown> }> {
	const res = await h.app.request('/admin/webhooks/endpoints', {
		method: 'POST',
		headers: h.adminHeaders,
		body: JSON.stringify({ url, events }),
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
