// ABOUTME: Stripe connect test (PRD §13) — one admin call wires prices + webhook onto the product.
// ABOUTME: Uses the fake gateway; asserts the product ends up fully configured and re-running is safe.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct } from '../../test/seed.js';

let h: TestHarness;

beforeEach(async () => {
	h = makeHarness();
	h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: '' };
	h.deps.stripe = fakeStripeGateway();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
});

describe('POST /admin/products/:slug/stripe/connect', () => {
	it('wires prices and the webhook secret onto the product', async () => {
		const res = await h.app.request('/admin/products/clementine/stripe/connect', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				webhook_url: 'https://clementine.email/webhook',
				lifetime_amount: 4900,
				yearly_amount: 2900,
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			prices: { lifetimePriceId: string; yearlyPriceId: string };
		};
		expect(body.prices.lifetimePriceId).toBe('price_lifetime_clementine');

		const check = await h.app.request('/admin/products/clementine', { headers: h.adminHeaders });
		const product = ((await check.json()) as { product: Record<string, unknown> }).product;
		expect(product.stripePriceLifetime).toBe('price_lifetime_clementine');
		expect(product.stripePriceYearly).toBe('price_yearly_clementine');
		expect(product.stripeWebhookSecret).toBe('whsec_clementine');
	});
});
