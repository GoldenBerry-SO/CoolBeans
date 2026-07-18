// ABOUTME: Floating-license tests (PRD §9) — lease heartbeat keeps a seat, expiry frees it.
// ABOUTME: A crashed client's lease lapses so it never permanently consumes a floating seat.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, issueKey, post } from '../../test/seed.js';

let h: TestHarness;
let key: string;

beforeEach(async () => {
	h = makeHarness();
	await createProduct(h.app, {
		slug: 'hexis',
		name: 'Hexis',
		key_prefix: 'HEX',
		email_from: 'Hexis <k@hexis.app>',
		activation_limit: 2,
		activation_model: 'floating',
		floating_lease_minutes: 30,
	});
	key = await issueKey(h.app, { product: 'hexis', email: 'buyer@example.com', tier: 'yearly' });
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
});
