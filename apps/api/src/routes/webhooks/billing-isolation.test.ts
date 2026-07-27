// ABOUTME: Proves the two Stripe integrations cannot be mistaken for each other in either direction.
// ABOUTME: This is the suite that justifies the separate gateway, URL, secret and price filter.

import { accounts, licenses } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../config.js';
import { fakeBillingGateway, fakeStripeGateway, makeHarness } from '../../test/harness.js';
import { createProduct, seedGrant } from '../../test/seed.js';

// No underscores past the prefix: connect validates price ids against /^price_[A-Za-z0-9]+$/,
// and the reserved-price guard only fires once a well-formed id gets that far.
const PRO_PRICE = 'price_coolbeansPro';
const PRODUCT_PRICE = 'price_customers_own_app';

/** Both integrations configured at once, which is the situation that has to be safe. */
const bothConfigured: Partial<Config> = {
	stripe: { secretKey: 'sk_customer', webhookSecret: 'whsec_customer' },
	billing: {
		stripeSecretKey: 'sk_billing',
		stripeWebhookSecret: 'whsec_billing',
		proPriceId: PRO_PRICE,
	},
};

async function harness() {
	const h = await makeHarness({ config: bothConfigured });
	h.deps.stripe = fakeStripeGateway({}, { cs_platform: [PRO_PRICE] });
	h.deps.billing = fakeBillingGateway({
		subscriptions: {
			sub_1: {
				id: 'sub_1',
				status: 'active',
				currentPeriodEnd: '2027-01-01T00:00:00.000Z',
				cancelAtPeriodEnd: false,
				priceId: PRO_PRICE,
			},
		},
	});
	await h.deps.db.update(accounts).set({ plan: 'free' }).where(eq(accounts.id, 1));
	return h;
}

const planOf = async (h: Awaited<ReturnType<typeof harness>>) => {
	const [row] = await h.deps.db.select().from(accounts).where(eq(accounts.id, 1)).limit(1);
	return row?.plan;
};

describe('a platform subscription event cannot issue a licence key', () => {
	it('is not matched to any product by the product webhook', async () => {
		const h = await harness();
		// A genuinely configured product: its own price maps to a grant. The Pro price still
		// resolves to nothing, so a Pro payment cannot borrow this product's issuance.
		const clementine = await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@c.io',
		});
		await seedGrant(h.deps, {
			productId: clementine.id as number,
			priceId: PRODUCT_PRICE,
			kind: 'perpetual',
		});

		// Somebody paying Goldenberry for Pro, delivered to the customer-product endpoint.
		const res = await h.app.request('/v1/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 'evt_platform_1',
				type: 'checkout.session.completed',
				created: 1_800_000_000,
				data: {
					object: {
						id: 'cs_platform',
						mode: 'subscription',
						payment_status: 'paid',
						customer: 'cus_1',
						subscription: 'sub_1',
						metadata: { coolbeans_account_id: '1' },
					},
				},
			}),
		});
		expect(res.status).toBe(200);
		// No key issued: the Pro price matches no product.
		expect(await h.deps.db.select().from(licenses)).toHaveLength(0);
	});
});

describe('a product sale cannot grant Pro', () => {
	it('fails signature verification at the billing endpoint', async () => {
		const h = await harness();
		// 'valid' is the product gateway's signature. The billing endpoint verifies against
		// a different secret, so the payload cannot get past the door — no parsing, no
		// price check, nothing.
		const res = await h.app.request('/v1/billing/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 'evt_product_1',
				type: 'checkout.session.completed',
				created: 1_800_000_000,
				data: { object: { mode: 'payment', metadata: { coolbeans_account_id: '1' } } },
			}),
		});
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toMatchObject({ error: 'invalid_signature' });
		expect(await planOf(h)).toBe('free');
	});

	it('is ignored at the billing endpoint even when correctly signed', async () => {
		// Belt and braces: if the two ever did share a secret, the price filter still has
		// to refuse. A product sale is not a subscription to our Pro price.
		const h = await harness();
		const res = await h.app.request('/v1/billing/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid-billing', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 'evt_product_2',
				type: 'customer.subscription.updated',
				created: 1_800_000_000,
				data: {
					object: {
						id: 'sub_customers_own',
						status: 'active',
						metadata: { coolbeans_account_id: '1' },
						items: { data: [{ price: { id: PRODUCT_PRICE } }] },
					},
				},
			}),
		});
		expect(res.status).toBe(200);
		expect(await planOf(h)).toBe('free');
	});
});

describe('the two webhook URLs are distinct routes', () => {
	it('does not let the billing path be matched as a :product slug', async () => {
		// /v1/stripe/webhook/:product and /v1/billing/stripe/webhook differ at the second
		// segment, so neither can capture the other.
		const h = await harness();
		const res = await h.app.request('/v1/billing/stripe/webhook', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
		});
		// The billing route answered (missing signature), not the product route.
		expect((await res.json()) as { error: string }).toMatchObject({ error: 'missing_signature' });
	});
});

describe('the reverse guard on product prices', () => {
	it('refuses to map the Pro price as a grant', async () => {
		// A grant on the Pro price would resolve a Cool Beans Pro purchase to a product and
		// issue somebody a licence key for it. The grants API is the only place prices get
		// mapped now — connect stopped taking prices — so the guard lives there.
		const h = await harness();
		await createProduct(h.app, {
			slug: 'sneaky',
			name: 'Sneaky',
			key_prefix: 'SNEAK',
			email_from: 'r@c.io',
		});
		const res = await h.app.request('/admin/products/sneaky/grants', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({ stripe_price_id: PRO_PRICE, kind: 'perpetual' }),
		});
		expect(res.status).toBe(409);
		expect((await res.json()) as { error: string }).toMatchObject({ error: 'reserved_price' });
	});

	it('refuses it as a subscription grant too', async () => {
		const h = await harness();
		await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@c.io',
		});
		const res = await h.app.request('/admin/products/clementine/grants', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({ stripe_price_id: PRO_PRICE, kind: 'subscription' }),
		});
		expect(res.status).toBe(409);
		expect((await res.json()) as { error: string }).toMatchObject({ error: 'reserved_price' });
	});
});
