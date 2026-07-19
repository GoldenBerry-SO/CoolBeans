// ABOUTME: The /admin/billing surface — plan status, checkout and portal, and who may reach them.
// ABOUTME: A cbp_ product token must never open a checkout session for a whole account.

import { accounts } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../config.js';
import { fakeBillingGateway, makeHarness } from '../../test/harness.js';
import { createProduct, signUp } from '../../test/seed.js';

const PRO_PRICE = 'price_pro_123';

const cloud: Partial<Config> = {
	billing: {
		stripeSecretKey: 'sk_billing',
		stripeWebhookSecret: 'whsec_billing',
		proPriceId: PRO_PRICE,
	},
	logMagicCodes: true,
};

function harness(config: Partial<Config> = cloud) {
	const h = makeHarness({ config });
	if (config.billing) h.deps.billing = fakeBillingGateway();
	h.deps.db.update(accounts).set({ plan: 'free' }).where(eq(accounts.id, 1)).run();
	return h;
}

/**
 * Checkout needs a signed-in human, because Stripe sends card-failure notices to their
 * address. Sign up so these tests exercise the path a real customer takes.
 */
async function withSession() {
	const h = harness();
	const headers = await signUp(h.app, h.logger, 'chris@alpha.test', 'alpha');
	const account = h.deps.db.$client
		.prepare("SELECT id FROM accounts WHERE name = 'alpha'")
		.get() as {
		id: number;
	};
	return { h, headers, accountId: account.id };
}

describe('GET /admin/billing', () => {
	it('reports the plan and current usage', async () => {
		const h = harness();
		await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@c.io',
		});
		const res = await h.app.request('/admin/billing', { headers: h.adminHeaders });
		const body = (await res.json()) as { billing: Record<string, unknown> };
		expect(body.billing).toMatchObject({ enabled: true, plan: 'free' });
		expect(body.billing.usage).toEqual({
			products: { current: 1, limit: 1 },
			active_licenses: { current: 0, limit: 500 },
		});
	});

	it('reports billing disabled on a self-host instance', async () => {
		// The console hides the page entirely on this, so a self-hoster is never shown an
		// upgrade button for something they already own outright.
		const h = harness({});
		const res = await h.app.request('/admin/billing', { headers: h.adminHeaders });
		const body = (await res.json()) as { billing: Record<string, unknown> };
		expect(body.billing.enabled).toBe(false);
		expect(body.billing.usage).toEqual({
			products: { current: 0, limit: null },
			active_licenses: { current: 0, limit: null },
		});
	});

	it('requires authentication', async () => {
		const h = harness();
		expect((await h.app.request('/admin/billing')).status).toBe(401);
	});
});

describe('POST /admin/billing/checkout', () => {
	it('creates a customer once, against the signed-in admin address', async () => {
		const { h, headers } = await withSession();
		const first = await h.app.request('/admin/billing/checkout', { method: 'POST', headers });
		expect(first.status).toBe(200);
		expect((await first.json()) as { url: string }).toMatchObject({
			url: expect.stringContaining('checkout.stripe.test'),
		});

		await h.app.request('/admin/billing/checkout', { method: 'POST', headers });
		// Persisted before the session is created, so a checkout that falls over leaves a
		// reusable customer rather than an orphan.
		const gateway = h.deps.billing as ReturnType<typeof fakeBillingGateway>;
		expect(gateway.created).toEqual([{ email: 'chris@alpha.test', accountId: 2 }]);
		expect(gateway.checkouts).toHaveLength(2);
	});

	it('refuses an instance token, which has no address for card-failure notices', async () => {
		// A subscription whose owner never hears that their payment is failing is the
		// dunning blind spot invoice.payment_failed exists to close.
		const h = harness();
		const res = await h.app.request('/admin/billing/checkout', {
			method: 'POST',
			headers: h.adminHeaders,
		});
		expect(res.status).toBe(409);
		expect((await res.json()) as { error: string }).toMatchObject({
			error: 'no_billing_contact',
		});
	});

	it('stamps the account on both the session and the subscription', async () => {
		const { h, headers, accountId } = await withSession();
		await h.app.request('/admin/billing/checkout', { method: 'POST', headers });
		const gateway = h.deps.billing as ReturnType<typeof fakeBillingGateway>;
		// Carried on the subscription too, so every later lifecycle event identifies its
		// account without depending on an earlier write having landed.
		expect(gateway.checkouts[0]).toMatchObject({ accountId, priceId: PRO_PRICE });
	});

	it('sends an already-subscribed account to the portal instead', async () => {
		// A stale tab would otherwise open a second subscription on the same account.
		const { h, headers, accountId } = await withSession();
		await h.app.request('/admin/billing/checkout', { method: 'POST', headers });
		h.deps.db.$client
			.prepare('UPDATE account_subscriptions SET stripe_subscription_id = ? WHERE account_id = ?')
			.run('sub_1', accountId);
		h.deps.db.update(accounts).set({ plan: 'pro' }).where(eq(accounts.id, accountId)).run();

		const res = await h.app.request('/admin/billing/checkout', { method: 'POST', headers });
		const body = (await res.json()) as { url: string; already_subscribed: boolean };
		expect(body.already_subscribed).toBe(true);
		expect(body.url).toContain('portal.stripe.test');
	});

	it('refuses when billing is not configured', async () => {
		const h = harness({});
		const res = await h.app.request('/admin/billing/checkout', {
			method: 'POST',
			headers: h.adminHeaders,
		});
		expect(res.status).toBe(409);
		expect((await res.json()) as { error: string }).toMatchObject({
			error: 'billing_not_configured',
		});
	});
});

describe('POST /admin/billing/portal', () => {
	it('returns a portal URL once a customer exists', async () => {
		const { h, headers } = await withSession();
		await h.app.request('/admin/billing/checkout', { method: 'POST', headers });
		const res = await h.app.request('/admin/billing/portal', { method: 'POST', headers });
		expect(res.status).toBe(200);
		expect((await res.json()) as { url: string }).toMatchObject({
			url: expect.stringContaining('portal.stripe.test'),
		});
	});

	it('409s for an account that has never been to checkout', async () => {
		const h = harness();
		const res = await h.app.request('/admin/billing/portal', {
			method: 'POST',
			headers: h.adminHeaders,
		});
		expect(res.status).toBe(409);
		expect((await res.json()) as { error: string }).toMatchObject({ error: 'no_billing_account' });
	});
});

describe('a product-scoped token', () => {
	async function productToken() {
		const h = harness();
		const res = await h.app.request('/admin/products', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				slug: 'clementine',
				name: 'Clementine',
				key_prefix: 'CLEM',
				email_from: 'r@c.io',
			}),
		});
		const { product_token } = (await res.json()) as { product_token: string };
		return { h, headers: { Authorization: `Bearer ${product_token}` } };
	}

	it.each(['/admin/billing', '/admin/billing/checkout', '/admin/billing/portal'])(
		'cannot reach %s',
		async (path) => {
			// PRODUCT_SCOPED is default-deny and billing is deliberately not on it. A token
			// meant for one product's success page must not open billing for the account.
			const { h, headers } = await productToken();
			const res = await h.app.request(path, {
				method: path === '/admin/billing' ? 'GET' : 'POST',
				headers,
			});
			expect(res.status).toBe(403);
		},
	);
});
