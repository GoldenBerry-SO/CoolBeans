// ABOUTME: Floating-license tests (PRD §9) — lease heartbeat keeps a seat, expiry frees it.
// ABOUTME: A crashed client's lease lapses so it never permanently consumes a floating seat.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, issueKey, post } from '../../test/seed.js';

let h: TestHarness;
let key: string;

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'hexis',
		name: 'Hexis',
		key_prefix: 'HEX',
		email_from: 'Hexis <k@hexis.app>',
		activation_limit: 2,
		activation_model: 'floating',
		floating_lease_minutes: 30,
	});
	key = await issueKey(h.app, {
		product: 'hexis',
		email: 'buyer@example.com',
		kind: 'subscription',
	});
});

describe('floating leases', () => {
	it('grants seats up to the limit', async () => {
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'a' })).status,
		).toBe(200);
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'b' })).status,
		).toBe(200);
		const over = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'c' });
		expect(over.status).toBe(409);
	});

	it('frees an expired lease automatically (crashed client)', async () => {
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'a' });
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'b' });
		// Both leases lapse after 30 min; a new client can then take a seat.
		h.clock.advance(31 * 60_000);
		const revived = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'c' });
		expect(revived.status).toBe(200);
	});

	it('heartbeat renews the lease and holds the seat', async () => {
		const a = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'a' });
		const instanceId = (a.body.instance as { id: string }).id;
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'b' });

		// Just before expiry, heartbeat extends the lease.
		h.clock.advance(29 * 60_000);
		const hb = await post(h.app, '/v1/heartbeat', { license_key: key, instance_id: instanceId });
		expect(hb.status).toBe(200);
		expect(hb.body.lease_expires_at).toBeTruthy();

		// 5 more minutes: 'a' is still held (renewed), 'b' has lapsed -> only one free seat.
		h.clock.advance(5 * 60_000);
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'c' })).status,
		).toBe(200);
		const over = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'd' });
		expect(over.status).toBe(409);
	});

	it('reactivating by name cannot revive an expired lease past the limit', async () => {
		// 'a' and 'b' take both seats, then both leases lapse.
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'a' });
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'b' });
		h.clock.advance(31 * 60_000);
		// 'c' and 'd' take the two freed seats.
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'c' })).status,
		).toBe(200);
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'd' })).status,
		).toBe(200);
		// 'a' comes back by the same device name: the pool is full, so it must be refused.
		const revive = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'a' });
		expect(revive.status).toBe(409);
		expect(revive.body.error).toBe('activation_limit_reached');
	});

	it('heartbeat cannot resurrect an expired lease when the pool is full', async () => {
		const a = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'a' });
		const aId = (a.body.instance as { id: string }).id;
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'b' });
		h.clock.advance(31 * 60_000);
		// Both lapsed; 'c' and 'd' fill the pool.
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'c' });
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'd' });
		// 'a' heartbeats after crashing: pool is full, so it does not get a lease back.
		const hb = await post(h.app, '/v1/heartbeat', { license_key: key, instance_id: aId });
		expect(hb.status).toBe(200);
		expect(hb.body.lease_expires_at).toBeNull();
		// And the pool still refuses a fifth device.
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'e' })).status,
		).toBe(409);
	});

	it('heartbeat can revive an expired lease when a seat is free', async () => {
		const a = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'a' });
		const aId = (a.body.instance as { id: string }).id;
		h.clock.advance(31 * 60_000);
		// Lease lapsed but the pool has room: heartbeat reclaims the seat.
		const hb = await post(h.app, '/v1/heartbeat', { license_key: key, instance_id: aId });
		expect(hb.body.lease_expires_at).toBeTruthy();
	});

	it('heartbeat for an unknown instance does not fabricate a lease', async () => {
		const hb = await post(h.app, '/v1/heartbeat', { license_key: key, instance_id: 'ghost' });
		expect(hb.status).toBe(200);
		expect(hb.body.lease_expires_at).toBeNull();
	});
});
