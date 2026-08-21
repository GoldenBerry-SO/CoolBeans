// ABOUTME: Product archiving (PRD §16, issue #38) — retire a product without breaking its keys.
// ABOUTME: §9 is frozen: issued keys must keep validating forever, so this is never a row delete.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, issueKey, post } from '../../test/seed.js';

let h: TestHarness;
let key: string;

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
	key = await issueKey(h.app, {
		product: 'clementine',
		email: 'buyer@example.com',
		kind: 'perpetual',
	});
});

describe('DELETE /admin/products/:slug (archive)', () => {
	it('keeps existing keys validating against the frozen contract', async () => {
		const res = await h.app.request('/admin/products/clementine', {
			method: 'DELETE',
			headers: h.adminHeaders,
		});
		expect(res.status).toBe(200);

		const act = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Mac' });
		expect(act.status).toBe(200);
	});

	it('refuses to issue new keys for an archived product', async () => {
		await h.app.request('/admin/products/clementine', {
			method: 'DELETE',
			headers: h.adminHeaders,
		});
		const res = await h.app.request('/admin/keys', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({ product: 'clementine', email: 'late@example.com', kind: 'perpetual' }),
		});
		expect(res.status).toBe(409);
		expect(((await res.json()) as { error: string }).error).toBe('product_archived');
	});

	it('hides archived products from the console list but can include them on request', async () => {
		await h.app.request('/admin/products/clementine', {
			method: 'DELETE',
			headers: h.adminHeaders,
		});
		const hidden = await h.app.request('/admin/products', { headers: h.adminHeaders });
		expect(((await hidden.json()) as { products: unknown[] }).products).toHaveLength(0);

		const all = await h.app.request('/admin/products?include_archived=1', {
			headers: h.adminHeaders,
		});
		expect(((await all.json()) as { products: unknown[] }).products).toHaveLength(1);
	});

	it('can be un-archived', async () => {
		await h.app.request('/admin/products/clementine', {
			method: 'DELETE',
			headers: h.adminHeaders,
		});
		const res = await h.app.request('/admin/products/clementine', {
			method: 'PATCH',
			headers: h.adminHeaders,
			body: JSON.stringify({ archived: false }),
		});
		expect(res.status).toBe(200);
		const list = await h.app.request('/admin/products', { headers: h.adminHeaders });
		expect(((await list.json()) as { products: unknown[] }).products).toHaveLength(1);
	});
});

describe('archived products and the dashboard stats', () => {
	it('stops counting an archived product, matching the list and the plan cap', async () => {
		// The bug this pins: /admin/stats counted products with raw SQL and no archived
		// filter, so a vendor who archived a first-day mistake saw "Products 3" while the
		// console listed 2 and the plan cap counted 2. Two surfaces agreed and one lied.
		await createProduct(h.app, {
			slug: 'clementine-yearly',
			name: 'Clementine Yearly',
			key_prefix: 'CLEMY',
			email_from: 'r@clementine.email',
		});

		const before = await h.app.request('/admin/stats', { headers: h.adminHeaders });
		expect(((await before.json()) as { stats: { products: number } }).stats.products).toBe(2);

		await h.app.request('/admin/products/clementine-yearly', {
			method: 'DELETE',
			headers: h.adminHeaders,
		});

		const after = await h.app.request('/admin/stats', { headers: h.adminHeaders });
		expect(((await after.json()) as { stats: { products: number } }).stats.products).toBe(1);

		// And it agrees with the surface the operator actually reads.
		const list = await h.app.request('/admin/products', { headers: h.adminHeaders });
		expect(((await list.json()) as { products: unknown[] }).products).toHaveLength(1);
	});

	it('keeps counting licences and seats on an archived product', async () => {
		// Deliberately NOT filtered. Archiving stops new issuance; §9 promises issued keys
		// keep validating, so those licences really are active and those seats really are
		// in use. Zeroing them would hide live customers from the vendor who still owes
		// them support.
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Mac' });
		await h.app.request('/admin/products/clementine', {
			method: 'DELETE',
			headers: h.adminHeaders,
		});

		const res = await h.app.request('/admin/stats', { headers: h.adminHeaders });
		const { stats } = (await res.json()) as {
			stats: { products: number; active_licenses: number; live_activations: number };
		};
		expect(stats.products).toBe(0);
		expect(stats.active_licenses).toBe(1);
		expect(stats.live_activations).toBe(1);
	});
});
