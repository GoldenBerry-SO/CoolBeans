// ABOUTME: Stripe connect test (PRD §13) — one admin call references the vendor's prices + wires the webhook.
// ABOUTME: Uses the fake gateway; asserts the pasted price ids land on the product and re-running is safe.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct } from '../../test/seed.js';

let h: TestHarness;

const PRICES = { lifetime_price_id: 'price_lifeCLEM', yearly_price_id: 'price_yearCLEM' };

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
	it('stores the referenced prices and the webhook secret onto the product', async () => {
		const res = await h.app.request('/admin/products/clementine/stripe/connect', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				webhook_url: 'https://clementine.email/webhook',
				...PRICES,
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			prices: { lifetimePriceId: string; yearlyPriceId: string };
		};
		// The vendor's own price id is echoed back and stored, not one we minted.
		expect(body.prices.lifetimePriceId).toBe('price_lifeCLEM');

		const check = await h.app.request('/admin/products/clementine', { headers: h.adminHeaders });
		const product = ((await check.json()) as { product: Record<string, unknown> }).product;
		expect(product.stripePriceLifetime).toBe('price_lifeCLEM');
		expect(product.stripePriceYearly).toBe('price_yearCLEM');
		expect(product.stripeWebhookSecret).toBe('whsec_clementine');
	});

	it('rejects an id that is not a Stripe price id, before touching Stripe', async () => {
		// A vendor pasting a product id (prod_) or a checkout link would otherwise store a
		// value nothing matches at checkout time, silently issuing no key to a paid buyer.
		const res = await h.app.request('/admin/products/clementine/stripe/connect', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				webhook_url: 'https://clementine.email/webhook',
				lifetime_price_id: 'prod_notaprice',
				yearly_price_id: 'price_yearCLEM',
			}),
		});
		// A well-formed body with an invalid field is 422 here, the repo's convention.
		expect(res.status).toBe(422);

		// Nothing was stored: the product's prices stay null so a later valid connect is clean.
		const check = await h.app.request('/admin/products/clementine', { headers: h.adminHeaders });
		const product = ((await check.json()) as { product: Record<string, unknown> }).product;
		expect(product.stripePriceLifetime).toBeNull();
	});

	it('rejects the same price id for both tiers, which would issue every sale as lifetime', async () => {
		// Price resolution checks the lifetime column first, so identical ids would make a
		// yearly subscription resolve as a non-expiring lifetime licence.
		const res = await connect('price_sameCLEM', 'price_sameCLEM');
		expect(res.status).toBe(409);
		expect(await storedLifetime()).toBeNull();
	});

	it('rejects a lifetime tier pointed at a recurring price', async () => {
		h.deps.stripe = fakeStripeGateway(undefined, undefined, {
			prices: { price_badlife: { recurring: true }, price_yearCLEM: { recurring: true } },
		});
		const res = await connect('price_badlife', 'price_yearCLEM');
		expect(res.status).toBe(400);
		expect(await storedLifetime()).toBeNull();
	});

	it('rejects a yearly tier pointed at a one-time price', async () => {
		h.deps.stripe = fakeStripeGateway(undefined, undefined, {
			prices: { price_lifeCLEM: { recurring: false }, price_badyear: { recurring: false } },
		});
		const res = await connect('price_lifeCLEM', 'price_badyear');
		expect(res.status).toBe(400);
		expect(await storedLifetime()).toBeNull();
	});

	it('rejects a price id Stripe does not have', async () => {
		// Only the yearly price is seeded, so the lifetime id resolves to "not found".
		h.deps.stripe = fakeStripeGateway(undefined, undefined, {
			prices: { price_yearCLEM: { recurring: true } },
		});
		const res = await connect('price_ghost', 'price_yearCLEM');
		expect(res.status).toBe(400);
		expect(await storedLifetime()).toBeNull();
	});
});

/** POST a connect request with the two price ids; other tests read what got stored. */
async function connect(lifetime: string, yearly: string): Promise<Response> {
	return h.app.request('/admin/products/clementine/stripe/connect', {
		method: 'POST',
		headers: h.adminHeaders,
		body: JSON.stringify({
			webhook_url: 'https://clementine.email/webhook',
			lifetime_price_id: lifetime,
			yearly_price_id: yearly,
		}),
	});
}

async function storedLifetime(): Promise<unknown> {
	const check = await h.app.request('/admin/products/clementine', { headers: h.adminHeaders });
	return ((await check.json()) as { product: Record<string, unknown> }).product.stripePriceLifetime;
}

describe('connect never degrades a working integration', () => {
	it('keeps the stored secret when Stripe reuses an endpoint and returns none', async () => {
		// First connect stores a real secret.
		await h.app.request('/admin/products/clementine/stripe/connect', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({ webhook_url: 'https://clementine.email/webhook', ...PRICES }),
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
			body: JSON.stringify({ webhook_url: 'https://clementine.email/webhook', ...PRICES }),
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
			body: JSON.stringify({ webhook_url: 'https://clementine.email/webhook', ...PRICES }),
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
			body: JSON.stringify({ webhook_url: 'https://clementine.email/webhook', ...PRICES }),
		});
		const body = (await res.json()) as { dunning: { setting: string; note: string } };
		expect(body.dunning.setting).toBe('cancel_subscription');
		expect(body.dunning.note).toMatch(/cancel/i);
	});
});
