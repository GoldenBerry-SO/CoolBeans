// ABOUTME: The price listing behind the picker (issue #120) — browse the connected account's
// ABOUTME: prices instead of pasting ids, and infer kind from the price instead of asking.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../../config.js';
import { createCloudConnection } from '../../services/stripe-connection.js';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../../test/harness.js';
import { rawQuery } from '../../test/pg.js';
import { createProduct, signUp } from '../../test/seed.js';

let h: TestHarness;

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clem.test',
	});
});

const CATALOG = [
	{
		id: 'price_yearlyCLEM',
		nickname: 'Yearly',
		productName: 'Clementine',
		unitAmount: 4900,
		currency: 'eur',
		recurring: true,
		interval: 'year',
	},
	{
		id: 'price_lifetimeCLEM',
		nickname: null,
		productName: 'Clementine Lifetime',
		unitAmount: 12000,
		currency: 'eur',
		recurring: false,
	},
];

describe('GET /admin/products/:slug/stripe/prices', () => {
	it("lists the connected account's active prices with display facts and mapped state", async () => {
		h.deps.stripe = fakeStripeGateway(undefined, undefined, {
			priceCatalog: CATALOG,
			prices: { price_yearlyCLEM: { recurring: true, interval: 'year' } },
		});
		// Map one of the two, so the picker can badge it.
		const mapped = await h.app.request('/admin/products/clementine/grants', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({ stripe_price_id: 'price_yearlyCLEM', kind: 'subscription' }),
		});
		expect(mapped.status, await mapped.text()).toBe(200);

		const res = await h.app.request('/admin/products/clementine/stripe/prices', {
			headers: h.adminHeaders,
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			prices: Array<{ id: string; nickname: string | null; mapped: { product: string } | null }>;
		};
		expect(body.prices).toHaveLength(2);
		const yearly = body.prices.find((p) => p.id === 'price_yearlyCLEM');
		expect(yearly?.nickname).toBe('Yearly');
		expect(yearly?.mapped?.product).toBe('clementine');
		expect(body.prices.find((p) => p.id === 'price_lifetimeCLEM')?.mapped).toBeNull();
	});

	it('says Stripe refused when the listing is refused, per the #119 rule', async () => {
		const base = fakeStripeGateway();
		h.deps.stripe = {
			...base,
			async listPrices() {
				throw new Error('Invalid API key provided');
			},
		} as typeof base;
		const res = await h.app.request('/admin/products/clementine/stripe/prices', {
			headers: h.adminHeaders,
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toMatch(/refused/i);
	});

	it('names the connected account for a cloud vendor, so an empty list teaches, not taunts', async () => {
		const cloud: Partial<Config> = {
			stripe: { secretKey: 'sk', webhookSecret: 'wh' },
			connect: { secretKey: 'sk_c', webhookSecret: 'wh_c' },
			billing: { stripeSecretKey: 'sk_b', stripeWebhookSecret: 'wh_b', proPriceId: 'price_pro' },
			logMagicCodes: true,
		};
		const b = await makeHarness({ config: cloud });
		b.deps.connect = fakeStripeGateway(undefined, undefined, {
			priceCatalog: [],
			accountNames: { acct_vendor9: 'Clementine' },
		});
		const alice = await signUp(b.app, b.logger, 'alice@vendor9.test', 'vendor9');
		const aliceId = (
			await rawQuery<{ id: number }>("SELECT id FROM accounts WHERE name = 'vendor9'")
		)[0].id;
		await createCloudConnection(b.deps, {
			accountId: aliceId,
			stripeAccountId: 'acct_vendor9',
			actor: 'test',
		});
		await createProduct(
			b.app,
			{ slug: 'nine-app', name: 'Nine', key_prefix: 'NINE', email_from: 'a@vendor9.test' },
			alice,
		);
		const res = await b.app.request('/admin/products/nine-app/stripe/prices', { headers: alice });
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			prices: unknown[];
			connection: { stripe_account_id: string | null; account_name: string | null };
		};
		expect(body.prices).toHaveLength(0);
		expect(body.connection.stripe_account_id).toBe('acct_vendor9');
		expect(body.connection.account_name).toBe('Clementine');
	});

	it("404s another account's product, never 403", async () => {
		const res = await h.app.request('/admin/products/nope/stripe/prices', {
			headers: h.adminHeaders,
		});
		expect(res.status).toBe(404);
	});
});

describe('kind is inferred from the price (issue #120)', () => {
	it('creates a subscription grant from a recurring price with no kind given', async () => {
		h.deps.stripe = fakeStripeGateway(undefined, undefined, {
			prices: { price_recurCLEM: { recurring: true, interval: 'year' } },
		});
		const res = await h.app.request('/admin/products/clementine/grants', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({ stripe_price_id: 'price_recurCLEM' }),
		});
		const body = (await res.json()) as { grant: { kind: string } };
		expect(res.status, JSON.stringify(body)).toBe(200);
		expect(body.grant.kind).toBe('subscription');
	});

	it('creates a perpetual grant from a one-time price with no kind given', async () => {
		h.deps.stripe = fakeStripeGateway(undefined, undefined, {
			prices: { price_onceCLEM: { recurring: false } },
		});
		const res = await h.app.request('/admin/products/clementine/grants', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({ stripe_price_id: 'price_onceCLEM' }),
		});
		const body = (await res.json()) as { grant: { kind: string } };
		expect(res.status, JSON.stringify(body)).toBe(200);
		expect(body.grant.kind).toBe('perpetual');
	});

	it('an explicitly wrong kind is still refused, not silently corrected', async () => {
		h.deps.stripe = fakeStripeGateway(undefined, undefined, {
			prices: { price_recurCLEM: { recurring: true, interval: 'year' } },
		});
		const res = await h.app.request('/admin/products/clementine/grants', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({ stripe_price_id: 'price_recurCLEM', kind: 'perpetual' }),
		});
		expect(res.status).toBe(400);
	});
});
