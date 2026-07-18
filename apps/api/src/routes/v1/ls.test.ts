// ABOUTME: LS-parity tests (PRD §9) — the alias routes emit the Lemon Squeezy License API shape.
// ABOUTME: activated/valid/deactivated booleans, license_key object fields, and status mapping.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, issueKey } from '../../test/seed.js';

let h: TestHarness;
let key: string;

async function ls(path: string, body: Record<string, string>) {
	const res = await h.app.request(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(async () => {
	h = makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
	key = await issueKey(h.app, {
		product: 'clementine',
		email: 'buyer@example.com',
		tier: 'yearly',
	});
});

describe('LS parity: /v1/licenses/*', () => {
	it('activate returns the LS shape', async () => {
		const r = await ls('/v1/licenses/activate', { license_key: key, instance_name: 'Mac' });
		expect(r.status).toBe(200);
		expect(r.body.activated).toBe(true);
		expect(r.body.error).toBeNull();
		const lk = r.body.license_key as Record<string, unknown>;
		expect(lk.status).toBe('active');
		expect(lk.activation_limit).toBe(3);
		expect(lk.activation_usage).toBe(1);
		expect(lk.key).toMatch(/^CLEM-/);
		expect((r.body.instance as Record<string, unknown>).id).toBeTruthy();
		expect((r.body.meta as Record<string, unknown>).product_name).toBe('Clementine');
	});

	it('validate returns valid + license_key', async () => {
		const act = await ls('/v1/licenses/activate', { license_key: key, instance_name: 'Mac' });
		const instanceId = (act.body.instance as { id: string }).id;
		const r = await ls('/v1/licenses/validate', { license_key: key, instance_id: instanceId });
		expect(r.body.valid).toBe(true);
		expect((r.body.license_key as { status: string }).status).toBe('active');
	});

	it('deactivate returns deactivated:true', async () => {
		const act = await ls('/v1/licenses/activate', { license_key: key, instance_name: 'Mac' });
		const instanceId = (act.body.instance as { id: string }).id;
		const r = await ls('/v1/licenses/deactivate', { license_key: key, instance_id: instanceId });
		expect(r.body.deactivated).toBe(true);
	});

	it('maps a disabled key to status disabled with activated:false', async () => {
		await h.app.request(`/admin/keys/${key}/disable`, { method: 'POST', headers: h.adminHeaders });
		const r = await ls('/v1/licenses/activate', { license_key: key, instance_name: 'Mac' });
		expect(r.body.activated).toBe(false);
		expect(r.body.error).toBeTruthy();
	});

	it('maps an expired trial to status expired', async () => {
		const trialKey = await issueKey(h.app, {
			product: 'clementine',
			email: 't@example.com',
			tier: 'trial',
			trial_days: 1,
		});
		await ls('/v1/licenses/activate', { license_key: trialKey, instance_name: 'Mac' });
		h.clock.advance(2 * 86_400_000);
		const r = await ls('/v1/licenses/validate', { license_key: trialKey, instance_id: 'x' });
		expect((r.body.license_key as { status: string }).status).toBe('expired');
	});

	it('unknown key returns 404 (never disabled)', async () => {
		const r = await ls('/v1/licenses/activate', {
			license_key: 'CLEM-Z9Y8-X7W6-V5T4-S3R2',
			instance_name: 'x',
		});
		expect(r.status).toBe(404);
	});
});
