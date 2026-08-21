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

	it('drops an archived product out of every count, not just the product one', async () => {
		// The dashboard answers "what is my business doing now", so a retired product must
		// not inflate any tile. Its keys keep validating exactly as §9 promises, and the
		// data stays reachable through the product list with include_archived and through
		// the purchases lookup; it just stops being counted as live activity.
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Mac' });

		const before = await h.app.request('/admin/stats', { headers: h.adminHeaders });
		const seen = (await before.json()) as {
			stats: { active_licenses: number; live_activations: number };
		};
		expect(seen.stats.active_licenses).toBe(1);
		expect(seen.stats.live_activations).toBe(1);

		await h.app.request('/admin/products/clementine', {
			method: 'DELETE',
			headers: h.adminHeaders,
		});

		const res = await h.app.request('/admin/stats', { headers: h.adminHeaders });
		const { stats } = (await res.json()) as {
			stats: {
				products: number;
				active_licenses: number;
				total_licenses: number;
				live_activations: number;
				activations_7d: number;
			};
		};
		expect(stats.products).toBe(0);
		expect(stats.active_licenses).toBe(0);
		expect(stats.total_licenses).toBe(0);
		expect(stats.live_activations).toBe(0);
		expect(stats.activations_7d).toBe(0);
	});

	it('still lets the operator reach an archived product and its purchases', async () => {
		// The counts going quiet must not mean the data is gone. This is the line between
		// "not on the dashboard" and "lost".
		await h.app.request('/admin/products/clementine', {
			method: 'DELETE',
			headers: h.adminHeaders,
		});

		const all = await h.app.request('/admin/products?include_archived=1', {
			headers: h.adminHeaders,
		});
		expect(((await all.json()) as { products: unknown[] }).products).toHaveLength(1);

		const purchases = await h.app.request('/admin/purchases?email=buyer@example.com', {
			headers: h.adminHeaders,
		});
		expect(((await purchases.json()) as { purchases: unknown[] }).purchases).toHaveLength(1);
	});
});
