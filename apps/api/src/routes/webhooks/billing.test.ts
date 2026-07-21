// ABOUTME: The platform billing webhook — plan transitions, dunning, idempotency and stale events.
// ABOUTME: Real DB and real routing via makeHarness, so nothing here is mocked except Stripe itself.

import { accountSubscriptions, accounts } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../config.js';
import type { BillingSubscription } from '../../services/billing-gateway.js';
import { fakeBillingGateway, makeHarness } from '../../test/harness.js';
import { rawQuery } from '../../test/pg.js';

const PRO_PRICE = 'price_pro_123';
const OTHER_PRICE = 'price_someone_elses_product';

const cloud: Partial<Config> = {
	billing: {
		stripeSecretKey: 'sk_billing',
		stripeWebhookSecret: 'whsec_billing',
		proPriceId: PRO_PRICE,
	},
};

async function harness(subscriptions: Record<string, BillingSubscription> = {}) {
	const h = await makeHarness({ config: cloud });
	h.deps.billing = fakeBillingGateway({ subscriptions });
	// Migration 0010 grandfathers account 1 to pro so existing installs are not capped.
	// A cloud signup starts on free, and starting these tests there is what makes
	// "moves the account to Pro" mean anything at all.
	await h.deps.db.update(accounts).set({ plan: 'free' }).where(eq(accounts.id, 1));
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
	h: Awaited<ReturnType<typeof harness>>,
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

const planOf = async (h: Awaited<ReturnType<typeof harness>>) => {
	const [row] = await h.deps.db.select().from(accounts).where(eq(accounts.id, 1)).limit(1);
	return row?.plan;
};

const rowOf = async (h: Awaited<ReturnType<typeof harness>>) => {
	const [row] = await h.deps.db
		.select()
		.from(accountSubscriptions)
		.where(eq(accountSubscriptions.accountId, 1))
		.limit(1);
	return row;
};

describe('configuration and signature', () => {
	it('is inert when billing is not configured', async () => {
		const h = await makeHarness();
		const res = await send(h as Awaited<ReturnType<typeof harness>>, checkoutCompleted());
		expect(res.status).toBe(503);
		expect((await res.json()) as { error: string }).toMatchObject({
			error: 'billing_not_configured',
		});
	});

	it('requires a signature header', async () => {
		const h = await harness();
		const res = await h.app.request('/v1/billing/stripe/webhook', {
			method: 'POST',
			body: JSON.stringify(checkoutCompleted()),
		});
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toMatchObject({ error: 'missing_signature' });
	});

	it('refuses a body whose signature does not verify', async () => {
		const h = await harness();
		const res = await send(h, checkoutCompleted(), 'nope');
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toMatchObject({ error: 'invalid_signature' });
	});
});

describe('checkout completion', () => {
	it('moves the account to Pro and records the subscription', async () => {
		const h = await harness({ sub_1: proSubscription() });
		expect(await send(h, checkoutCompleted()).then((r) => r.status)).toBe(200);
		expect(await planOf(h)).toBe('pro');
		const row = await rowOf(h);
		expect(row?.stripeSubscriptionId).toBe('sub_1');
		expect(row?.stripeCustomerId).toBe('cus_1');
		expect(row?.status).toBe('active');
		expect(row?.currentPeriodEnd).toBe('2027-07-18T00:00:00.000Z');
	});

	it('ignores a checkout for somebody else price', async () => {
		// The whole point of the strict price filter: a subscription to some other product
		// on a shared Stripe account must never grant Cool Beans Pro.
		const h = await harness({ sub_1: proSubscription({ priceId: OTHER_PRICE }) });
		expect(await send(h, checkoutCompleted()).then((r) => r.status)).toBe(200);
		expect(await planOf(h)).toBe('free');
	});

	it('ignores a checkout with no account metadata', async () => {
		const h = await harness({ sub_1: proSubscription() });
		await send(h, checkoutCompleted({ metadata: {} }));
		expect(await planOf(h)).toBe('free');
	});

	it('ignores a one-off payment session', async () => {
		const h = await harness({ sub_1: proSubscription() });
		await send(h, checkoutCompleted({ mode: 'payment' }));
		expect(await planOf(h)).toBe('free');
	});

	it('ignores an unpaid session', async () => {
		const h = await harness({ sub_1: proSubscription() });
		await send(h, checkoutCompleted({ payment_status: 'unpaid' }));
		expect(await planOf(h)).toBe('free');
	});
});

describe('subscription lifecycle', () => {
	async function subscribed() {
		const h = await harness({ sub_1: proSubscription() });
		await send(h, checkoutCompleted());
		return h;
	}

	it('keeps Pro while past_due, because dunning is not a lockout', async () => {
		// Mirrors LAPSED_SUBSCRIPTION_STATUSES in services/stripe.ts: Stripe is still
		// retrying the card, so cutting them off now would be the §8 lockout.
		const h = await subscribed();
		await send(h, subscriptionEvent('customer.subscription.updated', { status: 'past_due' }));
		expect(await planOf(h)).toBe('pro');
		expect((await rowOf(h))?.status).toBe('past_due');
	});

	it.each(['unpaid', 'canceled', 'incomplete_expired'])('drops to Free on %s', async (status) => {
		const h = await subscribed();
		await send(h, subscriptionEvent('customer.subscription.updated', { status }));
		expect(await planOf(h)).toBe('free');
	});

	it('drops to Free when the subscription is deleted', async () => {
		const h = await subscribed();
		await send(h, subscriptionEvent('customer.subscription.deleted'));
		expect(await planOf(h)).toBe('free');
	});

	it('records a pending cancellation without downgrading yet', async () => {
		const h = await subscribed();
		await send(
			h,
			subscriptionEvent('customer.subscription.updated', { cancel_at_period_end: true }),
		);
		expect(await planOf(h)).toBe('pro');
		expect((await rowOf(h))?.cancelAtPeriodEnd).toBe(true);
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
		expect(await planOf(h)).toBe('pro');
	});
});

describe('dunning', () => {
	async function subscribed() {
		const h = await harness({ sub_1: proSubscription() });
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
		expect(await planOf(h)).toBe('pro');
		expect((await rowOf(h))?.pastDueSince).toBeTruthy();
	});

	it('keeps the original past-due date across repeated failures', async () => {
		const h = await subscribed();
		await send(h, {
			id: 'evt_fail_1',
			type: 'invoice.payment_failed',
			created: 1_800_000_200,
			data: { object: { customer: 'cus_1' } },
		});
		const first = (await rowOf(h))?.pastDueSince;
		h.clock.advance(86_400_000);
		await send(h, {
			id: 'evt_fail_2',
			type: 'invoice.payment_failed',
			created: 1_800_000_300,
			data: { object: { customer: 'cus_1' } },
		});
		expect((await rowOf(h))?.pastDueSince).toBe(first);
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
		expect((await rowOf(h))?.pastDueSince).toBeNull();
	});

	it('clears past due when the subscription goes active again', async () => {
		const h = await subscribed();
		await send(h, subscriptionEvent('customer.subscription.updated', { status: 'past_due' }));
		await send(
			h,
			subscriptionEvent('customer.subscription.updated', { status: 'active' }, 1_800_000_500),
		);
		expect((await rowOf(h))?.pastDueSince).toBeNull();
		expect(await planOf(h)).toBe('pro');
	});
});

describe('idempotency and ordering', () => {
	it('applies a redelivered event exactly once', async () => {
		const h = await harness({ sub_1: proSubscription() });
		const event = checkoutCompleted();
		expect((await send(h, event)).status).toBe(200);
		const repeat = await send(h, event);
		expect(repeat.status).toBe(200);
		expect((await repeat.json()) as { duplicate: boolean }).toMatchObject({ duplicate: true });
	});

	it('ignores a stale event that arrives after the one that superseded it', async () => {
		// Stripe retries for days, so a stale 'active' can land after the cancellation.
		const h = await harness({ sub_1: proSubscription() });
		await send(h, checkoutCompleted());
		await send(
			h,
			subscriptionEvent('customer.subscription.updated', { status: 'canceled' }, 1_800_000_900),
		);
		expect(await planOf(h)).toBe('free');

		await send(
			h,
			subscriptionEvent('customer.subscription.updated', { status: 'active' }, 1_800_000_500),
		);
		// The late 'active' must not resurrect a cancelled subscription.
		expect(await planOf(h)).toBe('free');
	});

	it('shares provider_events with the product webhook without colliding', async () => {
		const h = await harness({ sub_1: proSubscription() });
		await send(h, checkoutCompleted());
		const row = (
			await rawQuery<{ provider: string }>(
				"SELECT provider FROM provider_events WHERE id = 'evt_checkout_1'",
			)
		)[0];
		expect(row.provider).toBe('stripe_billing');
	});
});

describe('upgrading clears the overage record', () => {
	it('clears over_limit_since when the account moves to Pro', async () => {
		// The overage is resolved by the upgrade. Leaving the stamp would show a stale
		// "you went over" banner if the account ever dropped back to Free later.
		const h = await harness({ sub_1: proSubscription() });
		await h.deps.db
			.update(accounts)
			.set({ overLimitSince: '2026-01-01T00:00:00.000Z' })
			.where(eq(accounts.id, 1));

		await send(h, checkoutCompleted());
		expect(await planOf(h)).toBe('pro');
		const [row] = await h.deps.db.select().from(accounts).where(eq(accounts.id, 1)).limit(1);
		expect(row?.overLimitSince).toBeNull();
	});

	it('ignores an invoice naming an account that does not exist', async () => {
		const h = await harness();
		const res = await send(h, {
			id: 'evt_bogus_1',
			type: 'invoice.payment_failed',
			created: 1_800_000_200,
			data: { object: { customer: 'cus_x', metadata: { coolbeans_account_id: '9999' } } },
		});
		expect(res.status).toBe(200);
		// No subscription row invented for an account that is not there.
		const rows = (
			await rawQuery<{ n: number }>('SELECT COUNT(*)::int n FROM account_subscriptions')
		)[0];
		expect(rows.n).toBe(0);
	});
});

describe('sharing the Stripe account with other Goldenberry apps', () => {
	// The platform account will carry billing for several products. Stripe fans every
	// subscribed event out to every endpoint, so this webhook will receive sibling apps'
	// lifecycle events forever. An event that positively names another app must bounce
	// BEFORE the claim: otherwise every busy sibling writes a provider_events row and a
	// warn log here for the rest of time.
	it('bounces an event stamped for another app without touching the tables', async () => {
		const h = await harness();
		const res = await send(h, {
			id: 'evt_foreign_app_1',
			type: 'customer.subscription.updated',
			created: 1_800_000_000,
			data: {
				object: {
					id: 'sub_pace_1',
					object: 'subscription',
					customer: 'cus_pace',
					status: 'active',
					metadata: { gb_app: 'pace' },
				},
			},
		});
		// 200, so Stripe stops retrying: this endpoint is simply not that event's audience.
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, received: true, foreign: true });

		// And nothing landed: no claim row, no subscription state, no audit noise.
		expect(
			await rawQuery("SELECT id FROM provider_events WHERE id = 'evt_foreign_app_1'"),
		).toHaveLength(0);
		expect(await rawQuery('SELECT id FROM account_subscriptions')).toHaveLength(0);
	});

	it('processes an event stamped as our own', async () => {
		const h = await harness({ sub_1: proSubscription() });
		const res = await send(h, {
			id: 'evt_own_app_1',
			type: 'customer.subscription.updated',
			created: 1_800_000_000,
			data: {
				object: {
					id: 'sub_1',
					object: 'subscription',
					customer: 'cus_1',
					status: 'active',
					items: { data: [{ price: { id: PRO_PRICE } }] },
					metadata: { gb_app: 'coolbeans', coolbeans_account_id: '1' },
				},
			},
		});
		expect(res.status).toBe(200);
		// Claimed and completed like any of ours.
		expect(
			await rawQuery("SELECT id FROM provider_events WHERE id = 'evt_own_app_1'"),
		).toHaveLength(1);
	});

	it('still runs the price filter when no app is named', async () => {
		// Absence must NOT bounce: dashboard-created subscriptions and apps that have not
		// adopted the convention carry no gb_app, and the price filter is the authority on
		// money either way. Metadata is routing, never security.
		const h = await harness({
			sub_unstamped: proSubscription({ id: 'sub_unstamped', priceId: OTHER_PRICE }),
		});
		const res = await send(h, {
			id: 'evt_unstamped_1',
			type: 'customer.subscription.updated',
			created: 1_800_000_000,
			data: {
				object: {
					id: 'sub_unstamped',
					object: 'subscription',
					customer: 'cus_x',
					status: 'active',
					metadata: {},
				},
			},
		});
		expect(res.status).toBe(200);
		// Today's behaviour, pinned: claimed, then ignored on price, with the row kept.
		expect(
			await rawQuery("SELECT id FROM provider_events WHERE id = 'evt_unstamped_1'"),
		).toHaveLength(1);
		expect(await rawQuery('SELECT id FROM account_subscriptions')).toHaveLength(0);
	});

	it('bounces a foreign invoice in the current API shape (parent.subscription_details)', async () => {
		// The shape the installed SDK types model: metadata under parent.subscription_details.
		// The first version of this suite crafted subscription_details at the top level — the
		// same wrong place the helper read — and passed while real invoices fell through the
		// bounce. Codex caught it; both shapes are probed and covered now.
		const h = await harness();
		const res = await send(h, {
			id: 'evt_foreign_invoice_basil',
			type: 'invoice.payment_failed',
			created: 1_800_000_000,
			data: {
				object: {
					id: 'in_pace_basil',
					object: 'invoice',
					customer: 'cus_pace',
					parent: {
						type: 'subscription_details',
						subscription_details: {
							subscription: 'sub_pace_1',
							metadata: { gb_app: 'pace' },
						},
					},
				},
			},
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ foreign: true });
		expect(
			await rawQuery("SELECT id FROM provider_events WHERE id = 'evt_foreign_invoice_basil'"),
		).toHaveLength(0);
	});

	it('bounces a foreign checkout session, the third stamped surface', async () => {
		const h = await harness();
		const res = await send(h, {
			id: 'evt_foreign_checkout_1',
			type: 'checkout.session.completed',
			created: 1_800_000_000,
			data: {
				object: {
					id: 'cs_pace_1',
					object: 'checkout.session',
					customer: 'cus_pace',
					subscription: 'sub_pace_1',
					metadata: { gb_app: 'pace', pace_account_id: '7' },
				},
			},
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ foreign: true });
		expect(
			await rawQuery("SELECT id FROM provider_events WHERE id = 'evt_foreign_checkout_1'"),
		).toHaveLength(0);
		// And nothing was granted: no plan change, no subscription row.
		expect(await rawQuery("SELECT id FROM accounts WHERE plan = 'pro'")).toHaveLength(0);
	});

	it('bounces a foreign invoice event via the subscription metadata Stripe copies onto it', async () => {
		const h = await harness();
		const res = await send(h, {
			id: 'evt_foreign_invoice_1',
			type: 'invoice.payment_failed',
			created: 1_800_000_000,
			data: {
				object: {
					id: 'in_pace_1',
					object: 'invoice',
					customer: 'cus_pace',
					subscription: 'sub_pace_1',
					subscription_details: { metadata: { gb_app: 'pace' } },
				},
			},
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ foreign: true });
		expect(
			await rawQuery("SELECT id FROM provider_events WHERE id = 'evt_foreign_invoice_1'"),
		).toHaveLength(0);
	});
});
