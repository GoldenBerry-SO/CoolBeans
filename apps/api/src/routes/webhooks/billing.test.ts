// ABOUTME: The platform billing webhook — plan transitions, dunning, idempotency and stale events.
// ABOUTME: Real DB and real routing via makeHarness, so nothing here is mocked except Stripe itself.

import { accountSubscriptions, accounts } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../config.js';
import type { BillingSubscription } from '../../services/billing-gateway.js';
import { fakeBillingGateway, makeHarness } from '../../test/harness.js';

const PRO_PRICE = 'price_pro_123';
const OTHER_PRICE = 'price_someone_elses_product';

const cloud: Partial<Config> = {
	billing: {
		stripeSecretKey: 'sk_billing',
		stripeWebhookSecret: 'whsec_billing',
		proPriceId: PRO_PRICE,
	},
};

function harness(subscriptions: Record<string, BillingSubscription> = {}) {
	const h = makeHarness({ config: cloud });
	h.deps.billing = fakeBillingGateway({ subscriptions });
	// Migration 0010 grandfathers account 1 to pro so existing installs are not capped.
	// A cloud signup starts on free, and starting these tests there is what makes
	// "moves the account to Pro" mean anything at all.
	h.deps.db.update(accounts).set({ plan: 'free' }).where(eq(accounts.id, 1)).run();
	return h;
}

function proSubscription(overrides: Partial<BillingSubscription> = {}): BillingSubscription {
	return {
		id: 'sub_1',
		status: 'active',
		currentPeriodEnd: '2027-07-18T00:00:00.000Z',
		cancelAtPeriodEnd: false,
		priceId: PRO_PRICE,
		...overrides,
	};
}

async function send(
	h: ReturnType<typeof harness>,
	event: Record<string, unknown>,
	signature = 'valid-billing',
) {
	return h.app.request('/v1/billing/stripe/webhook', {
		method: 'POST',
		headers: { 'stripe-signature': signature, 'Content-Type': 'application/json' },
		body: JSON.stringify(event),
	});
}

function checkoutCompleted(overrides: Record<string, unknown> = {}) {
	return {
		id: 'evt_checkout_1',
		type: 'checkout.session.completed',
		created: 1_800_000_000,
		data: {
			object: {
				mode: 'subscription',
				payment_status: 'paid',
				customer: 'cus_1',
				subscription: 'sub_1',
				metadata: { coolbeans_account_id: '1' },
				...overrides,
			},
		},
	};
}

function subscriptionEvent(
	type: string,
	object: Record<string, unknown> = {},
	created = 1_800_000_100,
) {
	return {
		id: `evt_${type}_${created}`,
		type,
		created,
		data: {
			object: {
				id: 'sub_1',
				customer: 'cus_1',
				status: 'active',
				metadata: { coolbeans_account_id: '1' },
				items: { data: [{ price: { id: PRO_PRICE }, current_period_end: 1_900_000_000 }] },
				...object,
			},
		},
	};
}

const planOf = (h: ReturnType<typeof harness>) =>
	h.deps.db.select().from(accounts).where(eq(accounts.id, 1)).get()?.plan;

const rowOf = (h: ReturnType<typeof harness>) =>
	h.deps.db.select().from(accountSubscriptions).where(eq(accountSubscriptions.accountId, 1)).get();

describe('configuration and signature', () => {
	it('is inert when billing is not configured', async () => {
		const h = makeHarness();
		const res = await send(h as ReturnType<typeof harness>, checkoutCompleted());
		expect(res.status).toBe(503);
		expect((await res.json()) as { error: string }).toMatchObject({
			error: 'billing_not_configured',
		});
	});

	it('requires a signature header', async () => {
		const h = harness();
		const res = await h.app.request('/v1/billing/stripe/webhook', {
			method: 'POST',
			body: JSON.stringify(checkoutCompleted()),
		});
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toMatchObject({ error: 'missing_signature' });
	});

	it('refuses a body whose signature does not verify', async () => {
		const h = harness();
		const res = await send(h, checkoutCompleted(), 'nope');
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toMatchObject({ error: 'invalid_signature' });
	});
});

describe('checkout completion', () => {
	it('moves the account to Pro and records the subscription', async () => {
		const h = harness({ sub_1: proSubscription() });
		expect(await send(h, checkoutCompleted()).then((r) => r.status)).toBe(200);
		expect(planOf(h)).toBe('pro');
		const row = rowOf(h);
		expect(row?.stripeSubscriptionId).toBe('sub_1');
		expect(row?.stripeCustomerId).toBe('cus_1');
		expect(row?.status).toBe('active');
		expect(row?.currentPeriodEnd).toBe('2027-07-18T00:00:00.000Z');
	});

	it('ignores a checkout for somebody else price', async () => {
		// The whole point of the strict price filter: a subscription to some other product
		// on a shared Stripe account must never grant Cool Beans Pro.
		const h = harness({ sub_1: proSubscription({ priceId: OTHER_PRICE }) });
		expect(await send(h, checkoutCompleted()).then((r) => r.status)).toBe(200);
		expect(planOf(h)).toBe('free');
	});

	it('ignores a checkout with no account metadata', async () => {
		const h = harness({ sub_1: proSubscription() });
		await send(h, checkoutCompleted({ metadata: {} }));
		expect(planOf(h)).toBe('free');
	});

	it('ignores a one-off payment session', async () => {
		const h = harness({ sub_1: proSubscription() });
		await send(h, checkoutCompleted({ mode: 'payment' }));
		expect(planOf(h)).toBe('free');
	});

	it('ignores an unpaid session', async () => {
		const h = harness({ sub_1: proSubscription() });
		await send(h, checkoutCompleted({ payment_status: 'unpaid' }));
		expect(planOf(h)).toBe('free');
	});
});

describe('subscription lifecycle', () => {
	async function subscribed() {
		const h = harness({ sub_1: proSubscription() });
		await send(h, checkoutCompleted());
		return h;
	}

	it('keeps Pro while past_due, because dunning is not a lockout', async () => {
		// Mirrors LAPSED_SUBSCRIPTION_STATUSES in services/stripe.ts: Stripe is still
		// retrying the card, so cutting them off now would be the §8 lockout.
		const h = await subscribed();
		await send(h, subscriptionEvent('customer.subscription.updated', { status: 'past_due' }));
		expect(planOf(h)).toBe('pro');
		expect(rowOf(h)?.status).toBe('past_due');
	});

	it.each(['unpaid', 'canceled', 'incomplete_expired'])('drops to Free on %s', async (status) => {
		const h = await subscribed();
		await send(h, subscriptionEvent('customer.subscription.updated', { status }));
		expect(planOf(h)).toBe('free');
	});

	it('drops to Free when the subscription is deleted', async () => {
		const h = await subscribed();
		await send(h, subscriptionEvent('customer.subscription.deleted'));
		expect(planOf(h)).toBe('free');
	});

	it('records a pending cancellation without downgrading yet', async () => {
		const h = await subscribed();
		await send(
			h,
			subscriptionEvent('customer.subscription.updated', { cancel_at_period_end: true }),
		);
		expect(planOf(h)).toBe('pro');
		expect(rowOf(h)?.cancelAtPeriodEnd).toBe(true);
	});

	it('ignores a subscription event for a foreign price', async () => {
		const h = await subscribed();
		await send(
			h,
			subscriptionEvent('customer.subscription.updated', {
				status: 'canceled',
				items: { data: [{ price: { id: OTHER_PRICE } }] },
			}),
		);
		// Untouched: that event was not about us.
		expect(planOf(h)).toBe('pro');
	});
});

describe('dunning', () => {
	async function subscribed() {
		const h = harness({ sub_1: proSubscription() });
		await send(h, checkoutCompleted());
		return h;
	}

	it('marks past due on a failed payment without downgrading', async () => {
		const h = await subscribed();
		await send(h, {
			id: 'evt_fail_1',
			type: 'invoice.payment_failed',
			created: 1_800_000_200,
			data: { object: { customer: 'cus_1' } },
		});
		expect(planOf(h)).toBe('pro');
		expect(rowOf(h)?.pastDueSince).toBeTruthy();
	});

	it('keeps the original past-due date across repeated failures', async () => {
		const h = await subscribed();
		await send(h, {
			id: 'evt_fail_1',
			type: 'invoice.payment_failed',
			created: 1_800_000_200,
			data: { object: { customer: 'cus_1' } },
		});
		const first = rowOf(h)?.pastDueSince;
		h.clock.advance(86_400_000);
		await send(h, {
			id: 'evt_fail_2',
			type: 'invoice.payment_failed',
			created: 1_800_000_300,
			data: { object: { customer: 'cus_1' } },
		});
		expect(rowOf(h)?.pastDueSince).toBe(first);
	});

	it('clears past due when a payment succeeds', async () => {
		const h = await subscribed();
		await send(h, {
			id: 'evt_fail_1',
			type: 'invoice.payment_failed',
			created: 1_800_000_200,
			data: { object: { customer: 'cus_1' } },
		});
		await send(h, {
			id: 'evt_ok_1',
			type: 'invoice.payment_succeeded',
			created: 1_800_000_400,
			data: { object: { customer: 'cus_1' } },
		});
		expect(rowOf(h)?.pastDueSince).toBeNull();
	});

	it('clears past due when the subscription goes active again', async () => {
		const h = await subscribed();
		await send(h, subscriptionEvent('customer.subscription.updated', { status: 'past_due' }));
		await send(
			h,
			subscriptionEvent('customer.subscription.updated', { status: 'active' }, 1_800_000_500),
		);
		expect(rowOf(h)?.pastDueSince).toBeNull();
		expect(planOf(h)).toBe('pro');
	});
});

describe('idempotency and ordering', () => {
	it('applies a redelivered event exactly once', async () => {
		const h = harness({ sub_1: proSubscription() });
		const event = checkoutCompleted();
		expect((await send(h, event)).status).toBe(200);
		const repeat = await send(h, event);
		expect(repeat.status).toBe(200);
		expect((await repeat.json()) as { duplicate: boolean }).toMatchObject({ duplicate: true });
	});

	it('ignores a stale event that arrives after the one that superseded it', async () => {
		// Stripe retries for days, so a stale 'active' can land after the cancellation.
		const h = harness({ sub_1: proSubscription() });
		await send(h, checkoutCompleted());
		await send(
			h,
			subscriptionEvent('customer.subscription.updated', { status: 'canceled' }, 1_800_000_900),
		);
		expect(planOf(h)).toBe('free');

		await send(
			h,
			subscriptionEvent('customer.subscription.updated', { status: 'active' }, 1_800_000_500),
		);
		// The late 'active' must not resurrect a cancelled subscription.
		expect(planOf(h)).toBe('free');
	});

	it('shares provider_events with the product webhook without colliding', async () => {
		const h = harness({ sub_1: proSubscription() });
		await send(h, checkoutCompleted());
		const row = h.deps.db.$client
			.prepare("SELECT provider FROM provider_events WHERE id = 'evt_checkout_1'")
			.get() as { provider: string };
		expect(row.provider).toBe('stripe_billing');
	});
});

describe('upgrading clears the overage record', () => {
	it('clears over_limit_since when the account moves to Pro', async () => {
		// The overage is resolved by the upgrade. Leaving the stamp would show a stale
		// "you went over" banner if the account ever dropped back to Free later.
		const h = harness({ sub_1: proSubscription() });
		h.deps.db
			.update(accounts)
			.set({ overLimitSince: '2026-01-01T00:00:00.000Z' })
			.where(eq(accounts.id, 1))
			.run();

		await send(h, checkoutCompleted());
		expect(planOf(h)).toBe('pro');
		const row = h.deps.db.select().from(accounts).where(eq(accounts.id, 1)).get();
		expect(row?.overLimitSince).toBeNull();
	});

	it('ignores an invoice naming an account that does not exist', async () => {
		const h = harness();
		const res = await send(h, {
			id: 'evt_bogus_1',
			type: 'invoice.payment_failed',
			created: 1_800_000_200,
			data: { object: { customer: 'cus_x', metadata: { coolbeans_account_id: '9999' } } },
		});
		expect(res.status).toBe(200);
		// No subscription row invented for an account that is not there.
		const rows = h.deps.db.$client
			.prepare('SELECT COUNT(*) n FROM account_subscriptions')
			.get() as {
			n: number;
		};
		expect(rows.n).toBe(0);
	});
});
