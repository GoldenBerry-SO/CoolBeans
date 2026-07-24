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
