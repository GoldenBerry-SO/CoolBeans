// ABOUTME: Vendor-mediated activation for machines that will never reach us (issue #57).
// ABOUTME: The seat is consumed through the same atomic guard, so this cannot dodge the cap.

import { activations, auditLog } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../config.js';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, issueKey, signUp } from '../../test/seed.js';

const FINGERPRINT = 'AAAA-BBBB-CCCC-DDDD';

async function seeded(config: Partial<Config> = {}) {
	const h = await makeHarness({ config });
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@c.io',
		activation_limit: 2,
	});
	const key = await issueKey(h.app, {
		product: 'clementine',
		email: 'buyer@example.com',
		tier: 'lifetime',
	});
	return { h, key };
}

function mint(h: TestHarness, key: string, body: Record<string, unknown> = {}) {
	return h.app.request(`/admin/keys/${encodeURIComponent(key)}/offline-activation`, {
		method: 'POST',
		headers: h.adminHeaders,
		body: JSON.stringify({ fingerprint: FINGERPRINT, ...body }),
	});
}

function payloadOf(token: string) {
	const part = token.split('.')[1] ?? '';
	return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as {
		product: string;
		instance_id: string;
		tier: string;
		expires_at: string | null;
		exp: number;
		status: string;
		fingerprint?: string;
	};
}

describe('minting an offline activation', () => {
	it('returns a signed token bound to the supplied fingerprint', async () => {
		const { h, key } = await seeded();
		const res = await mint(h, key);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { token: string; instance_id: string };
		expect(body.token).toBeTruthy();

		const payload = payloadOf(body.token);
		expect(payload.product).toBe('clementine');
		expect(payload.status).toBe('active');
		// The token binds to the instance the seat was taken for, so it cannot be moved.
		expect(payload.instance_id).toBe(body.instance_id);
	});

	it('reports when the activation itself dies, not when the licence does', async () => {
		// The seeded licence is lifetime, so the licence expiry is null. Returning that as
		// the activation's expires_at tells an operator the blob never expires, while the
		// machine actually locks at the TTL — and it is air-gapped, so nobody finds out
		// until it does.
		const { h, key } = await seeded();
		const res = await mint(h, key);
		const body = (await res.json()) as { token: string; expires_at: string | null };
		expect(body.expires_at).not.toBeNull();
		expect(new Date(body.expires_at ?? '').getTime()).toBe(payloadOf(body.token).exp * 1000);
	});

	it('consumes a real seat, visible to the console like any other activation', async () => {
		const { h, key } = await seeded();
		await mint(h, key);
		const seats = await h.deps.db.select().from(activations);
		expect(seats).toHaveLength(1);
		expect(seats[0]?.name).toContain(FINGERPRINT);
	});

	it('refuses once the licence is at its activation limit', async () => {
		// This must not become a way around the cap: the guard is the same one the public
		// activate path uses.
		const { h, key } = await seeded();
		expect((await mint(h, key, { fingerprint: 'ONE' })).status).toBe(200);
		expect((await mint(h, key, { fingerprint: 'TWO' })).status).toBe(200);
		const third = await mint(h, key, { fingerprint: 'THREE' });
		expect(third.status).toBe(409);
		expect((await third.json()) as { error: string }).toMatchObject({
			error: 'activation_limit_reached',
		});
		expect(await h.deps.db.select().from(activations)).toHaveLength(2);
	});

	it('refuses a disabled licence', async () => {
		const { h, key } = await seeded();
		await h.app.request(`/admin/keys/${encodeURIComponent(key)}/disable`, {
			method: 'POST',
			headers: h.adminHeaders,
		});
		expect((await mint(h, key)).status).toBe(403);
	});

	it('404s an unknown key', async () => {
		const { h } = await seeded();
		expect((await mint(h, 'CLEM-ZZZZ-ZZZZ-ZZZZ-ZZZZ')).status).toBe(404);
	});

	it('requires a fingerprint', async () => {
		const { h, key } = await seeded();
		const res = await h.app.request(`/admin/keys/${encodeURIComponent(key)}/offline-activation`, {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(422);
	});
});

describe('the long TTL an air-gapped machine needs', () => {
	it('defaults to a year, because the machine can never refresh', async () => {
		const { h, key } = await seeded();
		const body = (await (await mint(h, key)).json()) as { token: string };
		const payload = payloadOf(body.token);
		const days = (payload.exp * 1000 - h.clock.now().getTime()) / 86_400_000;
		expect(Math.round(days)).toBe(365);
	});

	it('honours a configured TTL', async () => {
		const { h, key } = await seeded({ offlineActivationTtlDays: 30 });
		const body = (await (await mint(h, key)).json()) as { token: string };
		const payload = payloadOf(body.token);
		const days = (payload.exp * 1000 - h.clock.now().getTime()) / 86_400_000;
		expect(Math.round(days)).toBe(30);
	});

	it('never outlives the licence itself', async () => {
		// A one-year token on a licence that ends in a month would keep unlocking long
		// after the customer stopped paying, with no way to reach the machine.
		const h = await makeHarness();
		await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@c.io',
		});
		const expiresAt = new Date(h.clock.now().getTime() + 30 * 86_400_000).toISOString();
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'buyer@example.com',
			tier: 'yearly',
			expires_at: expiresAt,
		});
		const body = (await (await mint(h, key)).json()) as { token: string };
		const payload = payloadOf(body.token);
		// Clamped to the buffered licence expiry, well inside the 365-day default.
		expect(payload.exp * 1000).toBeLessThanOrEqual(new Date(payload.expires_at ?? '').getTime());
		expect((payload.exp * 1000 - h.clock.now().getTime()) / 86_400_000).toBeLessThan(365);
	});
});

describe('the audit trail', () => {
	it('records who issued it and for which machine', async () => {
		// This is the one activation a customer never performs themselves, so the operator
		// who did it has to be on the record.
		const { h, key } = await seeded();
		await mint(h, key);
		const [entry] = await h.deps.db
			.select()
			.from(auditLog)
			.where(eq(auditLog.action, 'activation.offline_issued'))
			.limit(1);
		expect(entry).toBeDefined();
		expect(entry?.actor).toBe('admin:token');
		expect(JSON.parse(entry?.detail ?? '{}')).toMatchObject({ fingerprint: FINGERPRINT });
	});
});

describe('tenancy', () => {
	it('cannot mint an activation for another account licence', async () => {
		const cloud: Partial<Config> = {
			billing: { stripeSecretKey: 'sk', proPriceId: 'price' },
			logMagicCodes: true,
		};
		const h = await makeHarness({ config: cloud });
		const alice = await signUp(h.app, h.logger, 'alice@alpha.test', 'alpha');
		const bob = await signUp(h.app, h.logger, 'bob@beta.test', 'beta');
		await createProduct(
			h.app,
			{ slug: 'alpha-app', name: 'Alpha', key_prefix: 'ALPHA', email_from: 'a@alpha.test' },
			alice,
		);
		const alphaKey = await issueKey(
			h.app,
			{ product: 'alpha-app', email: 'buyer@alpha.test', tier: 'lifetime' },
			alice,
		);
		const res = await h.app.request(
			`/admin/keys/${encodeURIComponent(alphaKey)}/offline-activation`,
			{ method: 'POST', headers: bob, body: JSON.stringify({ fingerprint: FINGERPRINT }) },
		);
		// 404, never 403: a 403 would confirm the key exists in someone else's account.
		expect(res.status).toBe(404);
		expect(await h.deps.db.select().from(activations)).toHaveLength(0);
	});
});

describe('the frozen public surface', () => {
	it('adds no public route — this is an admin path only', async () => {
		const { h, key } = await seeded();
		const res = await h.app.request('/v1/offline-activation', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ license_key: key, fingerprint: FINGERPRINT }),
		});
		expect(res.status).toBe(404);
	});

	it('leaves the licence usable on the normal online path', async () => {
		const { h, key } = await seeded();
		await mint(h, key);
		const res = await h.app.request('/v1/activate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ license_key: key, instance_name: 'a normal device' }),
		});
		expect(res.status).toBe(200);
	});
});

describe('findings from the Codex review', () => {
	it('refuses a floating product outright', async () => {
		// A floating seat is held by a lease the machine renews. An air-gapped machine can
		// never heartbeat, so its lease lapses, the server frees the seat, and an operator
		// can mint unlimited air-gapped tokens while every earlier machine stays unlocked.
		// Offline activation is inherently node-locked.
		const h = await makeHarness();
		await createProduct(h.app, {
			slug: 'floaty',
			name: 'Floaty',
			key_prefix: 'FLOAT',
			email_from: 'r@c.io',
			activation_model: 'floating',
			activation_limit: 2,
		});
		const key = await issueKey(h.app, {
			product: 'floaty',
			email: 'buyer@example.com',
			tier: 'lifetime',
		});
		const res = await h.app.request(`/admin/keys/${encodeURIComponent(key)}/offline-activation`, {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({ fingerprint: FINGERPRINT }),
		});
		expect(res.status).toBe(409);
		expect((await res.json()) as { error: string }).toMatchObject({
			error: 'floating_not_supported',
		});
		expect(await h.deps.db.select().from(activations)).toHaveLength(0);
	});

	it('does not extend an air-gapped token by the renewal buffer', async () => {
		// The buffer exists so a client that CAN reconnect has room to. An air-gapped
		// machine never will, so the buffer only lets it outlive the paid licence.
		const h = await makeHarness();
		await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@c.io',
		});
		const expiresAt = new Date(h.clock.now().getTime() + 30 * 86_400_000).toISOString();
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'buyer@example.com',
			tier: 'yearly',
			expires_at: expiresAt,
		});
		const body = (await (await mint(h, key)).json()) as { token: string };
		const payload = payloadOf(body.token);
		expect(payload.exp * 1000).toBeLessThanOrEqual(new Date(expiresAt).getTime());
		expect(new Date(payload.expires_at ?? '').getTime()).toBe(new Date(expiresAt).getTime());
	});

	it('binds the token to the fingerprint, so a copied blob cannot unlock another machine', async () => {
		// Without a fingerprint claim the SDK has nothing device-specific to check: it
		// stores the token's own instance id and then compares the token against it.
		const { h, key } = await seeded();
		const body = (await (await mint(h, key)).json()) as { token: string };
		expect(payloadOf(body.token).fingerprint).toBe(FINGERPRINT);
	});

	it('is unreachable with a product-scoped token', async () => {
		// Default-deny in PRODUCT_SCOPED already blocks this; pinning it so the allowlist
		// cannot quietly grow to include a route that mints year-long credentials.
		const { h } = await seeded();
		const created = await h.app.request('/admin/products', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				slug: 'second',
				name: 'Second',
				key_prefix: 'SECOND',
				email_from: 'r@c.io',
			}),
		});
		const { product_token } = (await created.json()) as { product_token: string };
		const key2 = await issueKey(h.app, {
			product: 'second',
			email: 'b@c.io',
			tier: 'lifetime',
		});
		const res = await h.app.request(`/admin/keys/${encodeURIComponent(key2)}/offline-activation`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${product_token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ fingerprint: FINGERPRINT }),
		});
		expect(res.status).toBe(403);
	});
});
