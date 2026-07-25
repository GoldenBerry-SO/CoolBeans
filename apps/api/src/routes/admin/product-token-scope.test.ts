// ABOUTME: Per-product admin token scoping (PRD §16) — a cbp_ token reaches only its own product.
// ABOUTME: Global surfaces (team, stats, audit, product creation) stay closed to scoped tokens.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, issueKey } from '../../test/seed.js';

let h: TestHarness;
let clemToken: string;
let hexKey: string;

async function rotateToken(slug: string): Promise<string> {
	const res = await h.app.request(`/admin/products/${slug}/token/rotate`, {
		method: 'POST',
		headers: h.adminHeaders,
	});
	return ((await res.json()) as { product_token: string }).product_token;
}

function scoped(token: string) {
	return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
	await createProduct(h.app, {
		slug: 'hexis',
		name: 'Hexis',
		key_prefix: 'HEX',
		email_from: 'r@hexis.app',
	});
	clemToken = await rotateToken('clementine');
	hexKey = await issueKey(h.app, { product: 'hexis', email: 'h@x.io', kind: 'perpetual' });
});

describe('a product token reaches its own product', () => {
	it('lists its own keys', async () => {
		await issueKey(h.app, { product: 'clementine', email: 'c@x.io', kind: 'perpetual' });
		const res = await h.app.request('/admin/products/clementine/keys', {
			headers: scoped(clemToken),
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as { keys: unknown[] }).keys).toHaveLength(1);
	});

	it('issues a key for its own product', async () => {
		const res = await h.app.request('/admin/keys', {
			method: 'POST',
			headers: scoped(clemToken),
			body: JSON.stringify({ product: 'clementine', email: 'buyer@x.io', kind: 'perpetual' }),
		});
		expect(res.status).toBe(200);
	});

	it('sees only its own product in the list', async () => {
		const res = await h.app.request('/admin/products', { headers: scoped(clemToken) });
		expect(res.status).toBe(200);
		const products = ((await res.json()) as { products: { slug: string }[] }).products;
		expect(products.map((p) => p.slug)).toEqual(['clementine']);
	});
});

describe('a product token cannot reach another product', () => {
	it('refuses another product key listing', async () => {
		const res = await h.app.request('/admin/products/hexis/keys', { headers: scoped(clemToken) });
		expect(res.status).toBe(403);
	});

	it('refuses to issue a key for another product', async () => {
		const res = await h.app.request('/admin/keys', {
			method: 'POST',
			headers: scoped(clemToken),
			body: JSON.stringify({ product: 'hexis', email: 'buyer@x.io', kind: 'perpetual' }),
		});
		expect(res.status).toBe(403);
	});

	it("refuses to disable another product's key", async () => {
		const res = await h.app.request(`/admin/keys/${encodeURIComponent(hexKey)}/disable`, {
			method: 'POST',
			headers: scoped(clemToken),
		});
		expect(res.status).toBe(403);
	});
});

describe('global surfaces stay closed to a product token', () => {
	it.each([
		['GET', '/admin/team'],
		['GET', '/admin/stats'],
		['GET', '/admin/audit'],
	])('refuses %s %s', async (method, path) => {
		const res = await h.app.request(path, { method, headers: scoped(clemToken) });
		expect(res.status).toBe(403);
	});

	it('refuses to create a product', async () => {
		const res = await h.app.request('/admin/products', {
			method: 'POST',
			headers: scoped(clemToken),
			body: JSON.stringify({
				slug: 'sneaky',
				name: 'Sneaky',
				key_prefix: 'SNK',
				email_from: 'r@sneaky.io',
			}),
		});
		expect(res.status).toBe(403);
	});

	it('refuses to rotate its own token (an owner action)', async () => {
		const res = await h.app.request('/admin/products/clementine/token/rotate', {
			method: 'POST',
			headers: scoped(clemToken),
		});
		expect(res.status).toBe(403);
	});
});
