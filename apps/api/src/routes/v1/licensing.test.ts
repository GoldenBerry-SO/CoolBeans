// ABOUTME: Policy tests for the frozen §9 contract — activate/validate/deactivate seat and status rules.
// ABOUTME: Covers seat limits, reuse, disabled-fails-closed, unknown-is-404, trial expiry, idempotency.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, issueKey, post } from '../../test/seed.js';

let h: TestHarness;
let key: string;

beforeEach(async () => {
	h = makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'Clementine <r@clementine.email>',
		activation_limit: 3,
	});
	key = await issueKey(h.app, {
		product: 'clementine',
		email: 'buyer@example.com',
		tier: 'yearly',
	});
});

describe('POST /v1/activate', () => {
	it('activates a device and returns the license + instance', async () => {
		const { status, body } = await post(h.app, '/v1/activate', {
			license_key: key,
			instance_name: "Chris's MacBook Pro",
		});
		expect(status).toBe(200);
		expect(body.ok).toBe(true);
		const license = body.license as Record<string, unknown>;
		expect(license.status).toBe('active');
		expect(license.tier).toBe('yearly');
		expect(license.product).toBe('clementine');
		expect((body.instance as Record<string, unknown>).id).toBeTruthy();
	});

	it('enforces the activation limit', async () => {
		for (let i = 0; i < 3; i++) {
			const r = await post(h.app, '/v1/activate', { license_key: key, instance_name: `dev-${i}` });
			expect(r.status).toBe(200);
		}
		const over = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'dev-4' });
		expect(over.status).toBe(409);
		expect(over.body.error).toBe('activation_limit_reached');
	});

	it('reuses the same device by name without burning a seat', async () => {
		const first = await post(h.app, '/v1/activate', {
			license_key: key,
			instance_name: 'Same Mac',
		});
		const again = await post(h.app, '/v1/activate', {
			license_key: key,
			instance_name: 'Same Mac',
		});
		expect((first.body.instance as { id: string }).id).toBe(
			(again.body.instance as { id: string }).id,
		);
		// Two more distinct devices still fit under the limit of 3.
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'b' })).status,
		).toBe(200);
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'c' })).status,
		).toBe(200);
	});

	it('rejects a malformed key with 422 invalid_key', async () => {
		const r = await post(h.app, '/v1/activate', { license_key: 'nope', instance_name: 'x' });
		expect(r.status).toBe(422);
		expect(r.body.error).toBe('invalid_key');
	});

	it('returns 404 unknown_key for a well-formed but unknown key (never disabled)', async () => {
		const r = await post(h.app, '/v1/activate', {
			license_key: 'CLEM-A2B3-C4D5-E6F7-G8H9',
			instance_name: 'x',
		});
		expect(r.status).toBe(404);
		expect(r.body.error).toBe('unknown_key');
	});

	it('fails closed with 403 when the license is disabled', async () => {
		await h.app.request(`/admin/keys/${key}/disable`, { method: 'POST', headers: h.adminHeaders });
		const r = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'x' });
		expect(r.status).toBe(403);
		expect(r.body.error).toBe('license_disabled');
	});
});

describe('POST /v1/validate', () => {
	it('validates an active key + live instance and returns a token', async () => {
		const act = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Mac' });
		const instanceId = (act.body.instance as { id: string }).id;
		const r = await post(h.app, '/v1/validate', { license_key: key, instance_id: instanceId });
		expect(r.status).toBe(200);
		expect(r.body.valid).toBe(true);
		expect(r.body.token).toBeTruthy();
	});

	it('returns 200 valid:false with disabled status for a disabled key (definitive signal)', async () => {
		const act = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Mac' });
		const instanceId = (act.body.instance as { id: string }).id;
		await h.app.request(`/admin/keys/${key}/disable`, { method: 'POST', headers: h.adminHeaders });
		const r = await post(h.app, '/v1/validate', { license_key: key, instance_id: instanceId });
		expect(r.status).toBe(200);
		expect(r.body.valid).toBe(false);
		expect((r.body.license as { status: string }).status).toBe('disabled');
		expect(r.body.instance).toBeNull();
		expect(r.body.token).toBeUndefined();
	});

	it('active key with unknown instance is valid:false but license stays active', async () => {
		const r = await post(h.app, '/v1/validate', { license_key: key, instance_id: 'nonexistent' });
		expect(r.status).toBe(200);
		expect(r.body.valid).toBe(false);
		expect((r.body.license as { status: string }).status).toBe('active');
	});

	it('404 for unknown key is inconclusive, never a lockout', async () => {
		const r = await post(h.app, '/v1/validate', {
			license_key: 'CLEM-Z9Y8-X7W6-V5T4-S3R2',
			instance_id: 'x',
		});
		expect(r.status).toBe(404);
		expect(r.body.error).toBe('unknown_key');
	});
});

describe('POST /v1/deactivate', () => {
	it('frees the seat and is idempotent', async () => {
		const ids: string[] = [];
		for (let i = 0; i < 3; i++) {
			const r = await post(h.app, '/v1/activate', { license_key: key, instance_name: `d-${i}` });
			ids.push((r.body.instance as { id: string }).id);
		}
		// At the limit — a new device is refused.
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'new' })).status,
		).toBe(409);
		// Deactivate one, then the new device fits.
		const d = await post(h.app, '/v1/deactivate', { license_key: key, instance_id: ids[0] });
		expect(d.status).toBe(200);
		expect(d.body.ok).toBe(true);
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'new' })).status,
		).toBe(200);
		// Repeat deactivate and unknown instance both still return ok.
		expect(
			(await post(h.app, '/v1/deactivate', { license_key: key, instance_id: ids[0] })).body.ok,
		).toBe(true);
		expect(
			(await post(h.app, '/v1/deactivate', { license_key: key, instance_id: 'ghost' })).body.ok,
		).toBe(true);
	});
});

describe('trial expiry (lazy)', () => {
	it('validates active before expiry, disabled after', async () => {
		const trialKey = await issueKey(h.app, {
			product: 'clementine',
			email: 'trial@example.com',
			tier: 'trial',
			trial_days: 7,
		});
		const act = await post(h.app, '/v1/activate', { license_key: trialKey, instance_name: 'Mac' });
		const instanceId = (act.body.instance as { id: string }).id;
		const before = await post(h.app, '/v1/validate', {
			license_key: trialKey,
			instance_id: instanceId,
		});
		expect(before.body.valid).toBe(true);

		h.clock.advance(8 * 86_400_000);
		const after = await post(h.app, '/v1/validate', {
			license_key: trialKey,
			instance_id: instanceId,
		});
		expect(after.body.valid).toBe(false);
		expect((after.body.license as { status: string }).status).toBe('disabled');
	});
});
