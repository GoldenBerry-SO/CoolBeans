// ABOUTME: Stripe connect test (PRD §13) — one admin call wires prices + webhook onto the product.
// ABOUTME: Uses the fake gateway; asserts the product ends up fully configured and re-running is safe.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct } from '../../test/seed.js';

let h: TestHarness;

beforeEach(async () => {
	h = await makeHarness();
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

describe('connect never degrades a working integration', () => {
	it('keeps the stored secret when Stripe reuses an endpoint and returns none', async () => {
		// First connect stores a real secret.
		await h.app.request('/admin/products/clementine/stripe/connect', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				webhook_url: 'https://clementine.email/webhook',
				lifetime_amount: 4900,
				yearly_amount: 2900,
			}),
		});
		const first = await h.app.request('/admin/products/clementine', { headers: h.adminHeaders });
		const storedSecret = ((await first.json()) as { product: { stripeWebhookSecret: string } })
			.product.stripeWebhookSecret;
		expect(storedSecret).toBe('whsec_clementine');

		// Re-running against an existing endpoint yields no secret from Stripe; the
		// stored one must survive or every subsequent webhook fails verification.
		h.deps.stripe = fakeStripeGateway(undefined, undefined, { connectSecret: '' });
		const again = await h.app.request('/admin/products/clementine/stripe/connect', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				webhook_url: 'https://clementine.email/webhook',
				lifetime_amount: 4900,
				yearly_amount: 2900,
			}),
		});
		expect(again.status).toBe(200);

		const after = await h.app.request('/admin/products/clementine', { headers: h.adminHeaders });
		const secretAfter = ((await after.json()) as { product: { stripeWebhookSecret: string } })
			.product.stripeWebhookSecret;
		expect(secretAfter).toBe('whsec_clementine');
	});

	it('reports the per-product webhook URL to point Stripe at', async () => {
		const res = await h.app.request('/admin/products/clementine/stripe/connect', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				webhook_url: 'https://clementine.email/webhook',
				lifetime_amount: 4900,
				yearly_amount: 2900,
			}),
		});
		const body = (await res.json()) as { webhook_path: string };
		// The secret is stored per product, so only the per-product route can verify it.
		expect(body.webhook_path).toBe('/v1/stripe/webhook/clementine');
	});

	it('tells the operator what their dunning setting has to be (§13)', async () => {
		// customer.subscription.deleted only fires when Stripe's post-retry action is
		// cancel. We cannot read that setting over the API, so connect has to say it out
		// loud or a lapsed subscriber keeps working software forever.
		const res = await h.app.request('/admin/products/clementine/stripe/connect', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				webhook_url: 'https://clementine.email/webhook',
				lifetime_amount: 4900,
				yearly_amount: 2900,
			}),
		});
		const body = (await res.json()) as { dunning: { setting: string; note: string } };
		expect(body.dunning.setting).toBe('cancel_subscription');
		expect(body.dunning.note).toMatch(/cancel/i);
	});
});
