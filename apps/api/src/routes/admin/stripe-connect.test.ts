// ABOUTME: Stripe connect (PRD §13) is webhook registration only — prices are the grants API's job.
// ABOUTME: Pins that connect can never retire a grant: the two-price model it replaced did exactly that.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../../test/harness.js';
import { rawQuery } from '../../test/pg.js';
import { createProduct, seedGrant } from '../../test/seed.js';

let h: TestHarness;
let productId: number;

beforeEach(async () => {
	h = await makeHarness();
	h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: '' };
	h.deps.stripe = fakeStripeGateway();
	const product = await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
	productId = product.id as number;
});

async function connect(body: Record<string, unknown> = {}) {
	const res = await h.app.request('/admin/products/clementine/stripe/connect', {
		method: 'POST',
		headers: h.adminHeaders,
		body: JSON.stringify({ webhook_url: 'https://clementine.email/webhook', ...body }),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function connectionSecret(): Promise<string | null> {
	const rows = await rawQuery<{ webhook_secret: string | null }>(
		'SELECT webhook_secret FROM stripe_connections WHERE id = 1',
	);
	return rows[0]?.webhook_secret ?? null;
}

async function grantStatuses(): Promise<Array<{ price: string; status: string }>> {
	const rows = await rawQuery<{ stripe_price_id: string; status: string }>(
		'SELECT stripe_price_id, status FROM license_grants ORDER BY stripe_price_id',
	);
	return rows.map((r) => ({ price: r.stripe_price_id, status: r.status }));
}

describe('POST /admin/products/:slug/stripe/connect', () => {
	it('registers the webhook and stores the secret, and that is the whole job', async () => {
		const r = await connect();
		expect(r.status).toBe(200);
		expect(r.body.webhook_path).toBe('/v1/stripe/webhook');
		expect(await connectionSecret()).toBe('whsec_clementine');
		// No grants appeared: prices are mapped in the grants dialog, never here.
		expect(await grantStatuses()).toEqual([]);
	});

	it('never touches an existing grant', async () => {
		// The two-price model this replaced retired every active grant not in its pair, so an
		// operator who mapped three prices and then clicked Connect silently lost the third.
		// This is the regression test for the replaced behaviour, not just the new one.
		for (const [price, kind] of [
			['price_a', 'perpetual'],
			['price_b', 'subscription'],
			['price_c', 'perpetual'],
		] as const) {
			await seedGrant(h.deps, { productId, priceId: price, kind });
		}
		const r = await connect();
		expect(r.status).toBe(200);
		expect(await grantStatuses()).toEqual([
			{ price: 'price_a', status: 'active' },
			{ price: 'price_b', status: 'active' },
			{ price: 'price_c', status: 'active' },
		]);
	});

	it('refuses the replaced two-price body rather than accepting and ignoring it', async () => {
		// Accepting-and-ignoring would be worse than refusing: an operator pasting the old body
		// would believe two prices were mapped when nothing happened.
		const r = await connect({
			lifetime_price_id: 'price_life',
			yearly_price_id: 'price_year',
		});
		expect(r.status).toBeGreaterThanOrEqual(400);
		expect(JSON.stringify(r.body)).toMatch(/grant/i);
		expect(await grantStatuses()).toEqual([]);
	});

	it('keeps a path prefix in the registered endpoint URL', async () => {
		// new URL('/path', base) drops base's own path, so a self-host served under a prefix
		// (https://host/coolbeans) had its webhook registered at the bare host — every delivery
		// 404s and no key is ever issued, silently. Same class Bugbot caught in onboarding.
		let registered: string | undefined;
		const base = fakeStripeGateway();
		h.deps.stripe = {
			...base,
			async connect(args: { productSlug: string; webhookUrl: string }) {
				registered = args.webhookUrl;
				return base.connect(args);
			},
		} as typeof base;
		const r = await connect({ webhook_url: 'https://keys.example.com/coolbeans' });
		expect(r.status).toBe(200);
		expect(registered).toBe('https://keys.example.com/coolbeans/v1/stripe/webhook');
	});

	it('does not double the path when the operator pastes the full endpoint', async () => {
		// The dialog's placeholder shows the full path, so people paste it.
		let registered: string | undefined;
		const base = fakeStripeGateway();
		h.deps.stripe = {
			...base,
			async connect(args: { productSlug: string; webhookUrl: string }) {
				registered = args.webhookUrl;
				return base.connect(args);
			},
		} as typeof base;
		await connect({ webhook_url: 'https://keys.example.com/v1/stripe/webhook' });
		expect(registered).toBe('https://keys.example.com/v1/stripe/webhook');
	});

	it('refuses a webhook URL carrying a query or fragment, rather than mangling it', async () => {
		// z.string().url() accepts both, and concatenation would put the path INSIDE the query
		// ("?source=setup/v1/stripe/webhook"), an endpoint Stripe can deliver to but we never
		// answer. Codex and Bugbot found this one independently. Neither component means
		// anything for a webhook endpoint, so refusing beats silently rewriting what was typed.
		for (const url of [
			'https://keys.example.com/coolbeans?source=setup',
			'https://keys.example.com/coolbeans#setup',
		]) {
			const r = await connect({ webhook_url: url });
			expect(r.status, url).toBe(422);
			expect(JSON.stringify(r.body), url).toMatch(/query|fragment/i);
		}
	});

	it('normalizes a trailing slash instead of registering a double-slashed path', async () => {
		let registered: string | undefined;
		const base = fakeStripeGateway();
		h.deps.stripe = {
			...base,
			async connect(args: { productSlug: string; webhookUrl: string }) {
				registered = args.webhookUrl;
				return base.connect(args);
			},
		} as typeof base;
		await connect({ webhook_url: 'https://keys.example.com/coolbeans/' });
		expect(registered).toBe('https://keys.example.com/coolbeans/v1/stripe/webhook');
	});

	it('keeps the stored secret when Stripe reuses an endpoint and returns none', async () => {
		await connect();
		expect(await connectionSecret()).toBe('whsec_clementine');
		h.deps.stripe = fakeStripeGateway({}, {}, { connectSecret: '' });
		const r = await connect();
		expect(r.status).toBe(200);
		expect(r.body.secret_rotated).toBe(false);
		expect(await connectionSecret()).toBe('whsec_clementine');
	});

	it('tells the operator what their dunning setting has to be (§13)', async () => {
		const r = await connect();
		const dunning = r.body.dunning as { setting: string; note: string };
		expect(dunning.setting).toBe('cancel_subscription');
		expect(dunning.note).toMatch(/cancel the subscription/i);
	});

	it('answers a cloud Connect account sensibly instead of refusing', async () => {
		// A Connect vendor's events already arrive on the platform endpoint, verified by the
		// platform secret. There is nothing to register — and the old refusal pointed at "the
		// grants API instead of connect", a workflow distinction that no longer exists now that
		// connect does not map prices either.
		await rawQuery(
			`UPDATE stripe_connections SET mode = 'cloud_connect', stripe_account_id = 'acct_vendor1' WHERE id = 1`,
		);
		const r = await connect();
		expect(r.status).toBe(200);
		expect(r.body.webhook_path).toBe('/v1/connect/stripe/webhook');
		expect(r.body.secret_rotated).toBe(false);
		// Nothing was registered on the vendor's account and no secret moved.
		expect(JSON.stringify(r.body)).toMatch(/already/i);
	});

	it('404s a product on another account, never 403', async () => {
		const res = await h.app.request('/admin/products/nope/stripe/connect', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({ webhook_url: 'https://x.test/hook' }),
		});
		expect(res.status).toBe(404);
	});
});
