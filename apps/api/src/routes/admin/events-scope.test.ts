// ABOUTME: Webhook deliveries are attributed to an account, so the console's Webhooks page has rows.
// ABOUTME: Scoping /events without attributing the rows would leave every cloud account looking at nothing.

import { accounts } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../config.js';
import { fakeBillingGateway, fakeStripeGateway, makeHarness } from '../../test/harness.js';
import { rawQuery } from '../../test/pg.js';
import { createProduct, signUp } from '../../test/seed.js';

const cloud: Partial<Config> = {
	stripe: { secretKey: 'sk_customer', webhookSecret: 'whsec_customer' },
	billing: {
		stripeSecretKey: 'sk_billing',
		stripeWebhookSecret: 'whsec_billing',
		proPriceId: 'price_pro',
	},
	logMagicCodes: true,
};

async function harness() {
	const h = await makeHarness({ config: cloud });
	h.deps.stripe = fakeStripeGateway({}, { cs_1: ['price_lifetime_alpha-app'] });
	h.deps.billing = fakeBillingGateway({
		subscriptions: {
			sub_1: {
				id: 'sub_1',
				status: 'active',
				currentPeriodEnd: '2027-01-01T00:00:00.000Z',
				cancelAtPeriodEnd: false,
				priceId: 'price_pro',
			},
		},
	});
	await h.deps.db.update(accounts).set({ plan: 'free' }).where(eq(accounts.id, 1));
	return h;
}

async function eventsFor(h: Awaited<ReturnType<typeof harness>>, headers: Record<string, string>) {
	const res = await h.app.request('/admin/events', { headers });
	return ((await res.json()) as { events: { id: string }[] }).events.map((e) => e.id);
}

describe('provider event attribution', () => {
	it('shows a product delivery to the account that owns the product', async () => {
		const h = await harness();
		const alice = await signUp(h.app, h.logger, 'alice@alpha.test', 'alpha');
		const bob = await signUp(h.app, h.logger, 'bob@beta.test', 'beta');
		await createProduct(
			h.app,
			{
				slug: 'alpha-app',
				name: 'Alpha',
				key_prefix: 'ALPHA',
				email_from: 'a@alpha.test',
			},
			alice,
		);

		// Delivered to the per-product URL, which is what connectStripe tells customers to
		// register, so the owning account is known before anything is parsed.
		const res = await h.app.request('/v1/stripe/webhook/alpha-app', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 'evt_alpha_1',
				type: 'checkout.session.completed',
				created: 1_800_000_000,
				data: {
					object: {
						id: 'cs_1',
						mode: 'payment',
						customer_email: 'buyer@example.com',
						metadata: { product: 'alpha-app' },
					},
				},
			}),
		});
		expect(res.status).toBe(200);

		// This is the assertion that was silently false: the page had rows for nobody.
		expect(await eventsFor(h, alice)).toContain('evt_alpha_1');
		// And it stays out of the other account's list.
		expect(await eventsFor(h, bob)).not.toContain('evt_alpha_1');
	});

	it('shows a platform billing delivery to the account that was billed', async () => {
		const h = await harness();
		const alice = await signUp(h.app, h.logger, 'alice@alpha.test', 'alpha');
		const accountId = (
			await rawQuery<{ id: number }>("SELECT id FROM accounts WHERE name = 'alpha'")
		)[0];

		const res = await h.app.request('/v1/billing/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid-billing', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 'evt_billing_1',
				type: 'checkout.session.completed',
				created: 1_800_000_000,
				data: {
					object: {
						mode: 'subscription',
						payment_status: 'paid',
						customer: 'cus_1',
						subscription: 'sub_1',
						metadata: { coolbeans_account_id: String(accountId.id) },
					},
				},
			}),
		});
		expect(res.status).toBe(200);
		expect(await eventsFor(h, alice)).toContain('evt_billing_1');
	});

	it('still shows unattributed deliveries to a self-host instance token', async () => {
		// The global webhook has no product in the URL, so nothing identifies an account.
		// Those rows are instance-level operational noise and must not vanish on self-host.
		const h = await makeHarness({
			config: { stripe: { secretKey: 'sk', webhookSecret: 'whsec' } },
		});
		h.deps.stripe = fakeStripeGateway();
		await h.app.request('/v1/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 'evt_global_1',
				type: 'customer.subscription.updated',
				created: 1_800_000_000,
				data: { object: { id: 'sub_x', status: 'active' } },
			}),
		});
		expect(await eventsFor(h, h.adminHeaders)).toContain('evt_global_1');
	});
});
