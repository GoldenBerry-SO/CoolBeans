// ABOUTME: Race tests for the guarded limit paths (PRD §12, §20; CLAUDE.md makes these mandatory).
// ABOUTME: Requests are fired in parallel so any read-then-write across an await would overshoot.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from './harness.js';
import { createProduct, defineMetric, issueKey, post } from './seed.js';

let h: TestHarness;

beforeEach(async () => {
	h = await makeHarness();
});

/**
 * better-sqlite3 is synchronous, so these promises cannot truly interleave in one
 * process today — the guarded single statement is what makes the invariant hold.
 * The value of firing them in parallel is regression pressure: if a guarded
 * statement is ever split into a read and a later write across an await, the
 * interleaving becomes observable here and the invariant breaks. The same
 * invariants have to be re-proven against a real concurrent driver when the
 * Postgres adapter lands (issue #32).
 */
describe('activation seat limit under parallel activates', () => {
	it('never issues more live seats than the activation limit', async () => {
		await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@clementine.email',
			activation_limit: 3,
		});
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'buyer@example.com',
			tier: 'lifetime',
		});

		const attempts = 10;
		const results = await Promise.all(
			Array.from({ length: attempts }, (_, i) =>
				post(h.app, '/v1/activate', { license_key: key, instance_name: `device-${i}` }),
			),
		);

		const granted = results.filter((r) => r.status === 200);
		const refused = results.filter((r) => r.status === 409);
		expect(granted).toHaveLength(3);
		expect(refused).toHaveLength(attempts - 3);
		for (const r of refused) {
			expect((r.body as { error: string }).error).toBe('activation_limit_reached');
		}

		// The database itself must agree — no seat leaked past the guard.
		const detail = await h.app.request(`/admin/keys/${encodeURIComponent(key)}`, {
			headers: h.adminHeaders,
		});
		const body = (await detail.json()) as { activations: unknown[] };
		expect(body.activations).toHaveLength(3);
	});

	it('reusing one device name in parallel burns exactly one seat', async () => {
		await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@clementine.email',
			activation_limit: 3,
		});
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'buyer@example.com',
			tier: 'lifetime',
		});

		const results = await Promise.all(
			Array.from({ length: 5 }, () =>
				post(h.app, '/v1/activate', { license_key: key, instance_name: 'the-same-laptop' }),
			),
		);
		for (const r of results) expect(r.status).toBe(200);

		// PRD §9: reactivating the same device reuses its instance rather than burning a seat.
		const ids = new Set(results.map((r) => (r.body as { instance: { id: string } }).instance.id));
		expect(ids.size).toBe(1);

		const detail = await h.app.request(`/admin/keys/${encodeURIComponent(key)}`, {
			headers: h.adminHeaders,
		});
		const body = (await detail.json()) as { activations: unknown[] };
		expect(body.activations).toHaveLength(1);
	});
});

describe('usage quota under parallel increments', () => {
	it('never lets the counter exceed the limit', async () => {
		await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@clementine.email',
		});
		await defineMetric(h.app, 'clementine', {
			key: 'api_calls',
			display_name: 'API calls',
			default_limit: 10,
			reset_period: 'daily',
		});
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'buyer@example.com',
			tier: 'yearly',
		});
		const act = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Meter' });
		const instanceId = (act.body.instance as { id: string }).id;

		const attempts = 25;
		const results = await Promise.all(
			Array.from({ length: attempts }, () =>
				post(h.app, '/v1/usage/increment', {
					license_key: key,
					instance_id: instanceId,
					metric: 'api_calls',
					delta: 1,
				}),
			),
		);

		const ok = results.filter((r) => r.status === 200);
		const over = results.filter((r) => r.status === 429);
		expect(ok).toHaveLength(10);
		expect(over).toHaveLength(attempts - 10);

		const read = await h.app.request(`/v1/usage?license_key=${encodeURIComponent(key)}`);
		const counters = (await read.json()) as { usage: { metric: string; current: number }[] };
		expect(counters.usage.find((u) => u.metric === 'api_calls')?.current).toBe(10);
	});
});

describe('floating leases under parallel pressure (CLAUDE.md requires this)', () => {
	it('never lets more clients hold a floating seat than the limit', async () => {
		await createProduct(h.app, {
			slug: 'hexis',
			name: 'Hexis',
			key_prefix: 'HEX',
			email_from: 'r@hexis.app',
			activation_model: 'floating',
			activation_limit: 2,
		});
		const key = await issueKey(h.app, {
			product: 'hexis',
			email: 'team@northwind.io',
			tier: 'yearly',
		});

		const results = await Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				post(h.app, '/v1/activate', { license_key: key, instance_name: `render-node-${i}` }),
			),
		);
		expect(results.filter((r) => r.status === 200)).toHaveLength(2);
		expect(results.filter((r) => r.status === 409)).toHaveLength(6);
	});

	it('parallel heartbeats on one lease renew it without duplicating the seat', async () => {
		await createProduct(h.app, {
			slug: 'hexis',
			name: 'Hexis',
			key_prefix: 'HEX',
			email_from: 'r@hexis.app',
			activation_model: 'floating',
			activation_limit: 2,
		});
		const key = await issueKey(h.app, {
			product: 'hexis',
			email: 'team@northwind.io',
			tier: 'yearly',
		});
		const act = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'node-a' });
		const instanceId = (act.body.instance as { id: string }).id;

		const beats = await Promise.all(
			Array.from({ length: 6 }, () =>
				post(h.app, '/v1/heartbeat', { license_key: key, instance_id: instanceId }),
			),
		);
		for (const b of beats) {
			expect(b.status).toBe(200);
			expect(b.body.lease_expires_at).toBeTruthy();
		}

		// A second client must still be able to take the one remaining seat.
		const other = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'node-b' });
		expect(other.status).toBe(200);
		const third = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'node-c' });
		expect(third.status).toBe(409);
	});

	it('an expired lease frees its seat for a different client', async () => {
		await createProduct(h.app, {
			slug: 'hexis',
			name: 'Hexis',
			key_prefix: 'HEX',
			email_from: 'r@hexis.app',
			activation_model: 'floating',
			activation_limit: 1,
			floating_lease_minutes: 30,
		});
		const key = await issueKey(h.app, {
			product: 'hexis',
			email: 'team@northwind.io',
			tier: 'yearly',
		});
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'crashed-node' });

		const blocked = await post(h.app, '/v1/activate', {
			license_key: key,
			instance_name: 'fresh-node',
		});
		expect(blocked.status).toBe(409);

		h.clock.advance(31 * 60_000);
		const afterLapse = await post(h.app, '/v1/activate', {
			license_key: key,
			instance_name: 'fresh-node',
		});
		expect(afterLapse.status).toBe(200);
	});
});

describe('frozen §9 response shapes', () => {
	it('the license object carries exactly the five contract fields', async () => {
		await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@clementine.email',
		});
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'buyer@example.com',
			tier: 'lifetime',
		});
		const act = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Mac' });

		// Exact key set: a stray or renamed field is drift on a contract products build against.
		expect(Object.keys(act.body.license as object).sort()).toEqual([
			'expires_at',
			'key',
			'product',
			'status',
			'tier',
		]);
		expect(Object.keys(act.body.instance as object).sort()).toEqual(['id', 'name']);
		expect(Object.keys(act.body).sort()).toEqual(['instance', 'license', 'ok']);

		const instanceId = (act.body.instance as { id: string }).id;
		const val = await post(h.app, '/v1/validate', {
			license_key: key,
			instance_id: instanceId,
		});
		expect(Object.keys(val.body).sort()).toEqual(['instance', 'license', 'ok', 'token', 'valid']);

		const deact = await post(h.app, '/v1/deactivate', {
			license_key: key,
			instance_id: instanceId,
		});
		expect(Object.keys(deact.body)).toEqual(['ok']);
	});

	it('every error carries exactly ok, error and message', async () => {
		// The prefix must be known, otherwise this is 422 invalid_key rather than the
		// 404 unknown_key we want to shape-check.
		await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@clementine.email',
		});
		const unknown = await post(h.app, '/v1/activate', {
			license_key: 'CLEM-ZZZZ-ZZZZ-ZZZZ-ZZZZ',
			instance_name: 'Mac',
		});
		expect(unknown.status).toBe(404);
		expect(Object.keys(unknown.body).sort()).toEqual(['error', 'message', 'ok']);
	});
});
