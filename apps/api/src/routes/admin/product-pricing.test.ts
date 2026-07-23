// ABOUTME: Product pricing invariant — the two tiers can never map to the same Stripe price.
// ABOUTME: Guards create and patch, since price resolution reads the lifetime column first.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct } from '../../test/seed.js';

let h: TestHarness;

beforeEach(async () => {
	h = await makeHarness();
});

describe('a product tier prices must differ', () => {
	it('rejects creating a product with the same price for both tiers', async () => {
		const res = await h.app.request('/admin/products', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				slug: 'clementine',
				name: 'Clementine',
				key_prefix: 'CLEM',
				email_from: 'r@clementine.email',
				stripe_price_lifetime: 'price_dup',
				stripe_price_yearly: 'price_dup',
			}),
		});
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ ok: false, error: 'price_conflict' });
	});

	it('rejects patching one tier to the id the other already holds', async () => {
		await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@clementine.email',
			stripe_price_lifetime: 'price_life',
		});
		// Setting yearly to the id lifetime already holds is the same collision, even though
		// the patch body only names one tier.
		const res = await h.app.request('/admin/products/clementine', {
			method: 'PATCH',
			headers: h.adminHeaders,
			body: JSON.stringify({ stripe_price_yearly: 'price_life' }),
		});
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ ok: false, error: 'price_conflict' });
	});

	it('allows patching the two tiers to different prices', async () => {
		await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@clementine.email',
			stripe_price_lifetime: 'price_life',
		});
		const res = await h.app.request('/admin/products/clementine', {
			method: 'PATCH',
			headers: h.adminHeaders,
			body: JSON.stringify({ stripe_price_yearly: 'price_year' }),
		});
		expect(res.status).toBe(200);
	});
});
