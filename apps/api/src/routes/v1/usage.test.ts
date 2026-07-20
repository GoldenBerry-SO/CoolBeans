// ABOUTME: Usage metering tests (PRD §12) — atomic quota, over-limit 429, and period reset.
// ABOUTME: The guarded increment never overshoots; GET /v1/usage reflects current counters.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, defineMetric, issueKey, post } from '../../test/seed.js';

let h: TestHarness;
let key: string;
let instanceId: string;

beforeEach(async () => {
	h = await makeHarness();
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
	key = await issueKey(h.app, {
		product: 'clementine',
		email: 'buyer@example.com',
		tier: 'yearly',
	});
	// §9 binds metering to a live instance, so every increment needs a real seat.
	const act = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Meter' });
	instanceId = (act.body.instance as { id: string }).id;
});

describe('usage metering', () => {
	it('increments and reports current/limit/resets_at', async () => {
		const r = await post(h.app, '/v1/usage/increment', {
			license_key: key,
			instance_id: instanceId,
			metric: 'api_calls',
			delta: 3,
		});
		expect(r.status).toBe(200);
		expect(r.body.current).toBe(3);
		expect(r.body.limit).toBe(10);
		expect(r.body.resets_at).toBeTruthy();
	});

	it('returns 429 quota_exceeded when over the limit, with the same body shape', async () => {
		await post(h.app, '/v1/usage/increment', {
			license_key: key,
			instance_id: instanceId,
			metric: 'api_calls',
			delta: 10,
		});
		const over = await post(h.app, '/v1/usage/increment', {
			license_key: key,
			instance_id: instanceId,
			metric: 'api_calls',
			delta: 1,
		});
		expect(over.status).toBe(429);
		expect(over.body.error).toBe('quota_exceeded');
	});

	it('never overshoots the limit under repeated increments', async () => {
		let lastCurrent = 0;
		for (let i = 0; i < 20; i++) {
			const r = await post(h.app, '/v1/usage/increment', {
				license_key: key,
				instance_id: instanceId,
				metric: 'api_calls',
				delta: 1,
			});
			if (r.status === 200) lastCurrent = r.body.current as number;
		}
		expect(lastCurrent).toBe(10);
	});

	it('resets after the period rolls over', async () => {
		await post(h.app, '/v1/usage/increment', {
			license_key: key,
			instance_id: instanceId,
			metric: 'api_calls',
			delta: 10,
		});
		h.clock.advance(25 * 3_600_000);
		const r = await post(h.app, '/v1/usage/increment', {
			license_key: key,
			instance_id: instanceId,
			metric: 'api_calls',
			delta: 1,
		});
		expect(r.status).toBe(200);
		expect(r.body.current).toBe(1);
	});

	it('rejects an unknown metric with 404', async () => {
		const r = await post(h.app, '/v1/usage/increment', {
			license_key: key,
			instance_id: instanceId,
			metric: 'nope',
			delta: 1,
		});
		expect(r.status).toBe(404);
	});

	it('fails closed: a disabled license cannot consume quota', async () => {
		await h.app.request(`/admin/keys/${key}/disable`, { method: 'POST', headers: h.adminHeaders });
		const r = await post(h.app, '/v1/usage/increment', {
			license_key: key,
			instance_id: instanceId,
			metric: 'api_calls',
			delta: 1,
		});
		expect(r.status).toBe(403);
		expect(r.body.error).toBe('license_disabled');
	});

	it('GET /v1/usage lists counters for a key', async () => {
		await post(h.app, '/v1/usage/increment', {
			license_key: key,
			instance_id: instanceId,
			metric: 'api_calls',
			delta: 4,
		});
		const res = await h.app.request(`/v1/usage?license_key=${encodeURIComponent(key)}`);
		const body = (await res.json()) as { usage: Array<{ metric: string; current: number }> };
		expect(body.usage[0]?.metric).toBe('api_calls');
		expect(body.usage[0]?.current).toBe(4);
	});
});

describe('usage is bound to a live instance (PRD §9, §12)', () => {
	it('rejects an instance that was never activated', async () => {
		const r = await post(h.app, '/v1/usage/increment', {
			license_key: key,
			instance_id: 'never-activated',
			metric: 'api_calls',
			delta: 1,
		});
		expect(r.status).toBe(404);
		expect(r.body.error).toBe('unknown_instance');
	});

	it('stops metering once the device is deactivated, freeing its seat', async () => {
		const before = await post(h.app, '/v1/usage/increment', {
			license_key: key,
			instance_id: instanceId,
			metric: 'api_calls',
			delta: 1,
		});
		expect(before.status).toBe(200);

		await post(h.app, '/v1/deactivate', { license_key: key, instance_id: instanceId });

		const after = await post(h.app, '/v1/usage/increment', {
			license_key: key,
			instance_id: instanceId,
			metric: 'api_calls',
			delta: 1,
		});
		expect(after.status).toBe(404);
		expect(after.body.error).toBe('unknown_instance');
	});

	it('refuses an instance belonging to a different license', async () => {
		const other = await issueKey(h.app, {
			product: 'clementine',
			email: 'other@example.com',
			tier: 'yearly',
		});
		const act = await post(h.app, '/v1/activate', {
			license_key: other,
			instance_name: 'Other device',
		});
		const otherInstance = (act.body.instance as { id: string }).id;

		const r = await post(h.app, '/v1/usage/increment', {
			license_key: key,
			instance_id: otherInstance,
			metric: 'api_calls',
			delta: 1,
		});
		expect(r.status).toBe(404);
		expect(r.body.error).toBe('unknown_instance');
	});
});
