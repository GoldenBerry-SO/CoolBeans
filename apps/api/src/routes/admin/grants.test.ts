// ABOUTME: Admin grant routes (issue #62) — map arbitrary Stripe prices to a product, list, retire.
// ABOUTME: The general pricing surface; a price's billing mode must match the grant kind.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../../config.js';
import { createCloudConnection } from '../../services/stripe-connection.js';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../../test/harness.js';
import { rawQuery } from '../../test/pg.js';
import { createProduct, signUp } from '../../test/seed.js';

let h: TestHarness;

beforeEach(async () => {
	h = await makeHarness();
	h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: 'whsec_test' };
	h.deps.stripe = fakeStripeGateway();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
});

async function post(path: string, body: unknown) {
	const res = await h.app.request(path, {
		method: 'POST',
		headers: h.adminHeaders,
		body: JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function grants(): Promise<
	Array<{ stripePriceId: string; kind: string; status: string; plan: string | null }>
> {
	const res = await h.app.request('/admin/products/clementine/grants', { headers: h.adminHeaders });
	return (
		(await res.json()) as {
			grants: Array<{ stripePriceId: string; kind: string; status: string; plan: string | null }>;
		}
	).grants;
}

describe('POST /admin/products/:slug/grants', () => {
	it('maps a one-time price to a perpetual grant', async () => {
		const res = await post('/admin/products/clementine/grants', {
			stripe_price_id: 'price_onceCLEM',
			kind: 'perpetual',
			plan: 'Lifetime',
		});
		expect(res.status).toBe(200);
		expect(await grants()).toEqual([
			expect.objectContaining({
				stripePriceId: 'price_onceCLEM',
				kind: 'perpetual',
				status: 'active',
			}),
		]);
	});

	it('maps a recurring price to a subscription grant with a plan label', async () => {
		const res = await post('/admin/products/clementine/grants', {
			stripe_price_id: 'price_yearCLEM',
			kind: 'subscription',
			plan: 'Annual',
		});
		expect(res.status).toBe(200);
		expect((res.body.grant as { plan: string }).plan).toBe('Annual');
	});

	it('rejects a perpetual grant pointed at a recurring price', async () => {
		const res = await post('/admin/products/clementine/grants', {
			stripe_price_id: 'price_yearCLEM',
			kind: 'perpetual',
		});
		expect(res.status).toBe(400);
	});

	it('rejects a subscription grant pointed at a one-time price', async () => {
		const res = await post('/admin/products/clementine/grants', {
			stripe_price_id: 'price_onceCLEM',
			kind: 'subscription',
		});
		expect(res.status).toBe(400);
	});

	it('rejects a price Stripe does not have', async () => {
		h.deps.stripe = fakeStripeGateway(undefined, undefined, { prices: {} });
		const res = await post('/admin/products/clementine/grants', {
			stripe_price_id: 'price_ghostCLEM',
			kind: 'perpetual',
		});
		expect(res.status).toBe(400);
	});

	it('rejects an id that is not a Stripe price id', async () => {
		const res = await post('/admin/products/clementine/grants', {
			stripe_price_id: 'prod_notaprice',
			kind: 'perpetual',
		});
		expect(res.status).toBe(422);
	});

	it('re-mapping a price refreshes the grant in place (idempotent)', async () => {
		await post('/admin/products/clementine/grants', {
			stripe_price_id: 'price_onceCLEM',
			kind: 'perpetual',
			plan: 'Lifetime',
		});
		const again = await post('/admin/products/clementine/grants', {
			stripe_price_id: 'price_onceCLEM',
			kind: 'perpetual',
			plan: 'Lifetime v2',
		});
		expect(again.status).toBe(200);
		const active = await grants();
		expect(active).toHaveLength(1);
		expect(active[0]?.plan).toBe('Lifetime v2');
	});

	it('lets a cloud account map a grant on its own connection', async () => {
		// A second tenant with its own Stripe Connect connection, not the self-host default.
		const b = await makeHarness({
			config: {
				stripe: { secretKey: 'sk', webhookSecret: 'wh' },
				connect: { secretKey: 'sk_c', webhookSecret: 'wh_c' },
				billing: { stripeSecretKey: 'sk_b', stripeWebhookSecret: 'wh_b', proPriceId: 'price_pro' },
				logMagicCodes: true,
			},
		});
		b.deps.stripe = fakeStripeGateway();
		const alice = await signUp(b.app, b.logger, 'alice@x.test', 'alpha');
		const aliceId = (
			await rawQuery<{ id: number }>("SELECT id FROM accounts WHERE name = 'alpha'")
		)[0].id;
		await createCloudConnection(b.deps, {
			accountId: aliceId,
			stripeAccountId: 'acct_alice_grants',
			actor: 'test',
		});
		await createProduct(
			b.app,
			{ slug: 'alice-app', name: 'Alice', key_prefix: 'ALCE', email_from: 'a@x.test' },
			alice,
		);
		const res = await b.app.request('/admin/products/alice-app/grants', {
			method: 'POST',
			headers: alice,
			body: JSON.stringify({ stripe_price_id: 'price_aliceOnce', kind: 'perpetual' }),
		});
		expect(res.status).toBe(200);
	});

	it('rejects mapping our own Pro price to a product', async () => {
		const cloud: Partial<Config> = {
			stripe: { secretKey: 'sk_test', webhookSecret: 'whsec_test' },
			billing: {
				stripeSecretKey: 'sk_billing',
				stripeWebhookSecret: 'whsec_billing',
				proPriceId: 'price_coolbeansPro',
			},
		};
		const b = await makeHarness({ config: cloud });
		b.deps.stripe = fakeStripeGateway();
		await createProduct(b.app, {
			slug: 'sneaky',
			name: 'Sneaky',
			key_prefix: 'SNEAK',
			email_from: 'r@c.io',
		});
		const res = await b.app.request('/admin/products/sneaky/grants', {
			method: 'POST',
			headers: b.adminHeaders,
			body: JSON.stringify({ stripe_price_id: 'price_coolbeansPro', kind: 'subscription' }),
		});
		expect(res.status).toBe(409);
		expect((await res.json()) as { error: string }).toMatchObject({ error: 'reserved_price' });
	});
});

describe('POST /admin/products/:slug/grants/:id/retire', () => {
	it('retires a grant so it no longer shows as active', async () => {
		const created = await post('/admin/products/clementine/grants', {
			stripe_price_id: 'price_onceCLEM',
			kind: 'perpetual',
		});
		const id = (created.body.grant as { id: number }).id;
		const res = await post(`/admin/products/clementine/grants/${id}/retire`, {});
		expect(res.status).toBe(200);
		expect((res.body.grant as { status: string }).status).toBe('retired');
		// The active list (what the console and resolution read) no longer includes it.
		expect(await grants()).toHaveLength(0);
	});

	it('404s retiring a grant from another product', async () => {
		const res = await post('/admin/products/clementine/grants/9999/retire', {});
		expect(res.status).toBe(404);
	});

	it('cannot retire a grant belonging to another account (cross-account is 404)', async () => {
		const other = await makeHarness({
			config: {
				stripe: { secretKey: 'sk', webhookSecret: 'wh' },
				billing: {
					stripeSecretKey: 'sk_b',
					stripeWebhookSecret: 'wh_b',
					proPriceId: 'price_pro',
				},
				logMagicCodes: true,
			},
		});
		other.deps.stripe = fakeStripeGateway();
		const alice = await signUp(other.app, other.logger, 'alice@x.test', 'alpha');
		// Alice cannot see a grant id from another account; retiring any id under her product
		// 404s rather than confirming the grant exists elsewhere.
		await createProduct(
			other.app,
			{ slug: 'alpha-app', name: 'Alpha', key_prefix: 'ALPHA', email_from: 'a@x.test' },
			alice,
		);
		const res = await other.app.request('/admin/products/alpha-app/grants/1/retire', {
			method: 'POST',
			headers: alice,
		});
		expect(res.status).toBe(404);
	});
});
