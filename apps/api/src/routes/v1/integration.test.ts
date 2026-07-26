// ABOUTME: Public integration docs routes (#64) — the agent guide and per-product brief, no auth.
// ABOUTME: Asserts they serve markdown with the product's real config and 404 an unknown slug.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct } from '../../test/seed.js';

let h: TestHarness;

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'acme-app',
		name: 'Acme App',
		key_prefix: 'ACME',
		email_from: 'keys@acme.com',
	});
});

describe('GET /v1/llms.txt', () => {
	it('serves the agent guide as markdown, no auth', async () => {
		const res = await h.app.request('/v1/llms.txt');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/markdown');
		const body = await res.text();
		expect(body).toContain('/v1/activate');
		expect(body).toMatch(/never lock/i);
	});
});

describe('GET /v1/integration/:slug', () => {
	it('serves a per-product brief with the real config, no auth', async () => {
		const res = await h.app.request('/v1/integration/acme-app');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/markdown');
		const body = await res.text();
		expect(body).toContain('acme-app');
		expect(body).toContain('ACME');
		// Links back to the guide so an agent can fetch both.
		expect(body).toContain('/v1/llms.txt');
	});

	it('lists the capability names this product actually grants', async () => {
		// The names come from the vendor's own grants, so a coding agent never has to guess one —
		// and a guessed name silently leaves a paid feature switched off.
		const { seedGrant } = await import('../../test/seed.js');
		const product = await h.app.request('/admin/products/acme-app', { headers: h.adminHeaders });
		const { product: found } = (await product.json()) as { product: { id: number } };
		await seedGrant(h.deps, {
			productId: found.id,
			priceId: 'price_acmePro',
			kind: 'perpetual',
			entitlements: { export_4k: true, batch_limit: 100 },
		});
		const res = await h.app.request('/v1/integration/acme-app');
		const body = await res.text();
		expect(body).toContain('export_4k');
		expect(body).toContain('batch_limit');
	});

	it('never leaks the price a capability came from', async () => {
		// Grant ids and Stripe price ids are the vendor's business, not the app's.
		const { seedGrant } = await import('../../test/seed.js');
		const product = await h.app.request('/admin/products/acme-app', { headers: h.adminHeaders });
		const { product: found } = (await product.json()) as { product: { id: number } };
		await seedGrant(h.deps, {
			productId: found.id,
			priceId: 'price_acmeSecret',
			kind: 'perpetual',
			entitlements: { export_4k: true },
		});
		const body = await (await h.app.request('/v1/integration/acme-app')).text();
		expect(body).not.toContain('price_acmeSecret');
	});

	it('404s an unknown product, so it never confirms one that is not there', async () => {
		const res = await h.app.request('/v1/integration/nope');
		expect(res.status).toBe(404);
	});
});
