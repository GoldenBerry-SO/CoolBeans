// ABOUTME: Platform billing — an account's own Cool Beans subscription, driven by Stripe webhooks.
// ABOUTME: Reuses the provider_events claim and the stale-event comparator the product path already has.

import type { Account, AccountSubscription } from '@coolbeans/db';
import { accountSubscriptions, accounts } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowIso } from '../deps.js';
import { conflict } from '../http/errors.js';
import { getAccountById } from '../store/accounts.js';
import { writeAudit } from '../store/audit.js';
import { ACCOUNT_METADATA_KEY, APP_METADATA_KEY, APP_METADATA_VALUE } from './billing-gateway.js';
import { shouldApplySubscriptionEvent } from './event-order.js';
import type { StripeEvent } from './stripe-gateway.js';

/** provider_events.provider for platform billing, so both integrations coexist in that table. */
export const BILLING_PROVIDER = 'stripe_billing';

/**
 * Statuses that keep an account on Pro.
 *
 * `past_due` is deliberately included, mirroring LAPSED_SUBSCRIPTION_STATUSES in
 * services/stripe.ts: cutting a customer off the moment a card fails, while Stripe is
 * still retrying it, is the lockout §8 exists to prevent. They keep Pro and get a banner.
 */
const PAYING_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Refuse to map our own Pro price to a product via a grant.
 *
 * A checkout resolves to a product through the license grant on its paid price
 * (getGrantByPrice), so a grant on the Pro price would make a Cool Beans subscription
 * payment look like a sale of that product, and issue somebody a licence key for it. The
 * webhook side has four layers of separation; this is the one that stops the confusion
 * being configured in.
 */
/**
 * The app another Goldenberry product stamped on this event's object, if any.
 *
 * Read from wherever the object carries metadata: sessions and subscriptions have their
 * own, invoices carry the subscription's copy under subscription_details. Returns null
 * when the event is ours or when no app is named — absence must never bounce, because
 * dashboard-created objects and apps that have not adopted the stamp carry nothing, and
 * the price filter stays the authority on money either way. This is routing, not security.
 */
export function foreignAppOf(event: { data: { object: Record<string, unknown> } }): string | null {
	const object = event.data.object;
	const metadataOf = (holder: unknown): Record<string, unknown> | undefined =>
		(holder as { metadata?: Record<string, unknown> } | undefined)?.metadata;
	const own =
		metadataOf(object)?.[APP_METADATA_KEY] ??
		// Invoices carry the subscription's metadata copy. Where depends on the account's
		// API version: current (Basil) nests it under parent.subscription_details, older
		// versions put subscription_details at the top level. Probe both — the shape this
		// SDK's types model is the parent one, and a test crafted against the wrong shape
		// passed while real invoices sailed past the bounce, which is why this comment
		// names the field paths explicitly.
		metadataOf((object.parent as Record<string, unknown> | undefined)?.subscription_details)?.[
			APP_METADATA_KEY
		] ??
		metadataOf(object.subscription_details)?.[APP_METADATA_KEY];
	if (typeof own !== 'string' || own === '' || own === APP_METADATA_VALUE) return null;
	return own;
}

export function assertNotBillingPrice(
	deps: Pick<AppDeps, 'config'>,
	...priceIds: Array<string | null | undefined>
): void {
	const proPriceId = deps.config.billing?.proPriceId;
	if (!proPriceId) return;
	if (priceIds.some((id) => id === proPriceId)) {
		throw conflict(
			'reserved_price',
			'That price id is the Cool Beans Pro subscription and cannot be used as a product price.',
		);
	}
}

export async function getSubscriptionRow(
	deps: Pick<AppDeps, 'db'>,
	accountId: number,
): Promise<AccountSubscription | undefined> {
	const [row] = await deps.db
		.select()
		.from(accountSubscriptions)
		.where(eq(accountSubscriptions.accountId, accountId))
		.limit(1);
	return row;
}

/** The row for an account, created empty on first use. */
export async function ensureSubscriptionRow(
	deps: Pick<AppDeps, 'db'>,
	accountId: number,
): Promise<AccountSubscription> {
	const existing = await getSubscriptionRow(deps, accountId);
	if (existing) return existing;
	await deps.db.insert(accountSubscriptions).values({ accountId }).onConflictDoNothing();
	const row = await getSubscriptionRow(deps, accountId);
	if (!row) throw new Error(`Could not create a subscription row for account ${accountId}`);
	return row;
}

async function patchSubscription(
	deps: Pick<AppDeps, 'db' | 'now'>,
	accountId: number,
	patch: Partial<AccountSubscription>,
): Promise<void> {
	await deps.db
		.update(accountSubscriptions)
		.set({ ...patch, updatedAt: nowIso(deps) })
		.where(eq(accountSubscriptions.accountId, accountId));
}

/**
 * Remember the Stripe customer for an account. Called before checkout is created, so a
 * session that never completes still leaves a customer we can reuse.
 */
export async function setCustomerId(
	deps: Pick<AppDeps, 'db' | 'now'>,
	accountId: number,
	customerId: string,
): Promise<void> {
	await patchSubscription(deps, accountId, { stripeCustomerId: customerId });
}

/**
 * Move an account between plans. accounts.plan is what the limits read.
 *
 * Upgrading clears `over_limit_since`: the overage it recorded is resolved, and leaving
 * the stamp would make the console show a stale "you went over in March" banner if the
 * account ever dropped back to Free.
 */
export async function setPlan(
	deps: Pick<AppDeps, 'db'>,
	accountId: number,
	plan: 'free' | 'pro',
): Promise<void> {
	await deps.db
		.update(accounts)
		.set({ plan, ...(plan === 'pro' ? { overLimitSince: null } : {}) })
		.where(eq(accounts.id, accountId));
}

export async function findAccountByCustomerId(
	deps: Pick<AppDeps, 'db'>,
	customerId: string,
): Promise<number | undefined> {
	const [row] = await deps.db
		.select({ accountId: accountSubscriptions.accountId })
		.from(accountSubscriptions)
		.where(eq(accountSubscriptions.stripeCustomerId, customerId))
		.limit(1);
	return row?.accountId;
}

async function findAccountBySubscriptionId(
	deps: Pick<AppDeps, 'db'>,
	subscriptionId: string,
): Promise<number | undefined> {
	const [row] = await deps.db
		.select({ accountId: accountSubscriptions.accountId })
		.from(accountSubscriptions)
		.where(eq(accountSubscriptions.stripeSubscriptionId, subscriptionId))
		.limit(1);
	return row?.accountId;
}

function str(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

/** The account id stamped on a Stripe object's metadata, if present and sane. */
export function accountIdFromMetadata(object: Record<string, unknown>): number | undefined {
	const metadata = object.metadata as Record<string, unknown> | undefined;
	const raw = str(metadata?.[ACCOUNT_METADATA_KEY]);
	if (!raw || !/^\d+$/.test(raw)) return undefined;
	return Number(raw);
}

/** The price id on a subscription object, which Stripe nests under items. */
export function priceIdOfSubscription(object: Record<string, unknown>): string | null {
	const items = object.items as { data?: Array<{ price?: { id?: unknown } }> } | undefined;
	return str(items?.data?.[0]?.price?.id);
}

function periodEndOfSubscription(object: Record<string, unknown>): string | null {
	const items = object.items as { data?: Array<{ current_period_end?: unknown }> } | undefined;
	const end = items?.data?.[0]?.current_period_end;
	return typeof end === 'number' ? new Date(end * 1000).toISOString() : null;
}

export interface BillingEventOutcome {
	/** 'applied' | 'ignored' — ignored covers a foreign price, unknown account, stale event. */
	outcome: 'applied' | 'ignored';
	reason?: string;
	/** The account this event was about, so the caller can attribute the delivery to it. */
	accountId?: number;
}

/**
 * Apply one platform-billing event.
 *
 * Four independent things already keep this away from the customer-product path before we
 * get here: a distinct URL, a distinct signing secret, a distinct gateway and key, and the
 * price filter below. The price check is strict — an unmatched or missing price is
 * ignored and audited, never accepted. pleasehold's template defaults to accepting when
 * no price is configured, which is safe there and is precisely the failure to exclude
 * here, where accepting a foreign event could issue somebody a licence key.
 */
export async function handleBillingEvent(
	deps: AppDeps,
	event: StripeEvent,
): Promise<BillingEventOutcome> {
	const object = event.data.object;
	const proPriceId = deps.config.billing?.proPriceId;
	if (!proPriceId) return { outcome: 'ignored', reason: 'billing_not_configured' };

	const ignore = (reason: string): BillingEventOutcome => {
		deps.logger.warn('Platform billing event ignored', {
			event: event.id,
			type: event.type,
			reason,
		});
		return { outcome: 'ignored', reason };
	};

	switch (event.type) {
		case 'checkout.session.completed': {
			if (str(object.mode) !== 'subscription') return ignore('not_a_subscription');
			if (str(object.payment_status) === 'unpaid') return ignore('unpaid');
			const accountId = accountIdFromMetadata(object) ?? undefined;
			const subscriptionId = str(object.subscription);
			if (!accountId) return ignore('no_account_metadata');
			if (!subscriptionId) return ignore('no_subscription');

			// Authoritative price check: read the subscription rather than trusting the
			// session, so a session for some other product cannot grant Pro.
			const sub = await deps.billing?.getSubscription(subscriptionId);
			if (!sub) return ignore('subscription_not_found');
			if (sub.priceId !== proPriceId) return ignore('foreign_price');

			return await applySubscriptionState(deps, event, accountId, {
				subscriptionId,
				customerId: str(object.customer),
				status: sub.status,
				currentPeriodEnd: sub.currentPeriodEnd,
				cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
			});
		}

		case 'customer.subscription.updated':
		case 'customer.subscription.deleted': {
			const subscriptionId = str(object.id);
			if (!subscriptionId) return ignore('no_subscription_id');
			const priceId = priceIdOfSubscription(object);
			// Deletion events can arrive with the price already detached, so fall back to
			// the row we hold rather than ignoring a real cancellation.
			const known = await findAccountBySubscriptionId(deps, subscriptionId);
			if (priceId && priceId !== proPriceId) return ignore('foreign_price');
			if (!priceId && known === undefined) return ignore('unknown_subscription');

			const accountId = accountIdFromMetadata(object) ?? known;
			if (accountId === undefined) return ignore('no_account_metadata');

			const status =
				event.type === 'customer.subscription.deleted' ? 'canceled' : str(object.status);
			return await applySubscriptionState(deps, event, accountId, {
				subscriptionId,
				customerId: str(object.customer),
				status: status ?? 'canceled',
				currentPeriodEnd: periodEndOfSubscription(object),
				cancelAtPeriodEnd: object.cancel_at_period_end === true,
			});
		}

		case 'invoice.payment_failed':
		case 'invoice.payment_succeeded': {
			const customerId = str(object.customer);
			const accountId =
				accountIdFromMetadata(object) ??
				(customerId ? await findAccountByCustomerId(deps, customerId) : undefined);
			if (accountId === undefined) return ignore('unknown_customer');
			// Metadata is attacker-shaped input in principle, so confirm the account is real
			// before creating a subscription row that would reference nothing.
			if (!(await getAccountById(deps.db, accountId))) return ignore('unknown_account');
			const failed = event.type === 'invoice.payment_failed';
			// No downgrade on a failed payment. Stripe is still retrying the card, and the
			// subscription events will say when it truly lapses. Without this handler an
			// expired card is invisible until the subscription dies and the first the
			// customer hears about it is a downgrade.
			await ensureSubscriptionRow(deps, accountId);
			await patchSubscription(deps, accountId, {
				pastDueSince: failed
					? ((await getSubscriptionRow(deps, accountId))?.pastDueSince ?? nowIso(deps))
					: null,
			});
			await writeAudit(deps.db, {
				action: failed ? 'billing.payment_failed' : 'billing.payment_succeeded',
				actor: `stripe_billing:${event.id}`,
				accountId,
			});
			return { outcome: 'applied', accountId };
		}

		default:
			return { outcome: 'ignored', reason: 'unhandled_type' };
	}
}

interface SubscriptionState {
	subscriptionId: string;
	customerId: string | null;
	status: string;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
}

async function applySubscriptionState(
	deps: AppDeps,
	event: StripeEvent,
	accountId: number,
	state: SubscriptionState,
): Promise<BillingEventOutcome> {
	const account: Account | undefined = await getAccountById(deps.db, accountId);
	if (!account) {
		deps.logger.warn('Platform billing event for an account that does not exist', {
			event: event.id,
			account: accountId,
		});
		return { outcome: 'ignored', reason: 'unknown_account' };
	}

	const row = await ensureSubscriptionRow(deps, accountId);
	// Stripe retries for days and does not guarantee order, so a stale 'active' can land
	// after the cancellation that superseded it. Same comparator the product path uses.
	if (!shouldApplySubscriptionEvent(event.created, row.lastEventAt)) {
		deps.logger.warn('Stale platform billing event ignored', {
			event: event.id,
			created: event.created,
			lastApplied: row.lastEventAt,
		});
		return { outcome: 'ignored', reason: 'stale_event' };
	}

	const paying = PAYING_STATUSES.has(state.status);
	await patchSubscription(deps, accountId, {
		stripeSubscriptionId: state.subscriptionId,
		...(state.customerId ? { stripeCustomerId: state.customerId } : {}),
		status: state.status,
		currentPeriodEnd: state.currentPeriodEnd,
		cancelAtPeriodEnd: state.cancelAtPeriodEnd,
		// Anything paying clears the dunning flag; past_due keeps whatever it had.
		...(state.status === 'past_due' ? {} : { pastDueSince: null }),
		...(event.created !== undefined ? { lastEventAt: event.created } : {}),
	});
	await setPlan(deps, accountId, paying ? 'pro' : 'free');
	await writeAudit(deps.db, {
		action: paying ? 'billing.plan_active' : 'billing.plan_lapsed',
		actor: `stripe_billing:${event.id}`,
		accountId,
		detail: { status: state.status, subscription: state.subscriptionId },
	});
	return { outcome: 'applied', accountId };
}
