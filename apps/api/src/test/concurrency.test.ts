// ABOUTME: Race tests for the guarded limit paths (PRD §12, §20; CLAUDE.md makes these mandatory).
// ABOUTME: Requests are fired in parallel so any read-then-write across an await would overshoot.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from './harness.js';
import { createProduct, defineMetric, issueKey, post } from './seed.js';

let h: TestHarness;

beforeEach(() => {
	h = makeHarness();
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

		const attempts = 25;
		const results = await Promise.all(
			Array.from({ length: attempts }, () =>
				post(h.app, '/v1/usage/increment', {
					license_key: key,
					instance_id: 'inst-race',
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
