// ABOUTME: Customer portal tests (PRD §15) — key lookup lists devices; deactivate frees a seat.
// ABOUTME: The key is the credential; a disabled key still shows its definitive status.

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
		email_from: 'r@clementine.email',
		download_url: 'https://clementine.email/download',
	});
	key = await issueKey(h.app, {
		product: 'clementine',
		email: 'buyer@example.com',
		tier: 'yearly',
	});
});

describe('POST /v1/portal/lookup', () => {
	it('lists the license and its live devices, with the download link', async () => {
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Mac' });
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'iMac' });
		const r = await post(h.app, '/v1/portal/lookup', { license_key: key });
		expect(r.status).toBe(200);
		expect((r.body.license as { status: string }).status).toBe('active');
		expect(r.body.download_url).toBe('https://clementine.email/download');
		expect((r.body.activations as unknown[]).length).toBe(2);
	});

	it('a portal deactivate frees the seat', async () => {
		const act = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Mac' });
		const instanceId = (act.body.instance as { id: string }).id;
		await post(h.app, '/v1/deactivate', { license_key: key, instance_id: instanceId });
		const r = await post(h.app, '/v1/portal/lookup', { license_key: key });
		expect((r.body.activations as unknown[]).length).toBe(0);
	});

	it('shows a disabled license its definitive status', async () => {
		await h.app.request(`/admin/keys/${key}/disable`, { method: 'POST', headers: h.adminHeaders });
		const r = await post(h.app, '/v1/portal/lookup', { license_key: key });
		expect((r.body.license as { status: string }).status).toBe('disabled');
	});
});
