// ABOUTME: Stripe bookkeeping for an account's own Cool Beans subscription (the hosted plan).
// ABOUTME: Named account_subscriptions because "subscription" already means a customer's in services/stripe.ts.

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * One row per account that has ever reached checkout. Deliberately holds no plan column:
 * `accounts.plan` is the single source of the effective plan that limits read, and a
 * second copy here would be one more thing to drift.
 */
export const accountSubscriptions = sqliteTable('account_subscriptions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	accountId: integer('account_id').notNull().unique(),
	stripeCustomerId: text('stripe_customer_id').unique(),
	stripeSubscriptionId: text('stripe_subscription_id').unique(),
	/** Stripe's subscription status, stored verbatim rather than mapped. */
	status: text('status'),
	currentPeriodEnd: text('current_period_end'),
	cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).notNull().default(false),
	/**
	 * When the first payment failure landed. Set by invoice.payment_failed, cleared on a
	 * successful payment. Drives the console's "update your card" strip. A past-due
	 * account keeps its Pro limits: cutting them off mid-dunning is the lockout §8 exists
	 * to prevent.
	 */
	pastDueSince: text('past_due_since'),
	/**
	 * `created` of the newest subscription event applied, in unix seconds. Stripe retries
	 * for days and does not guarantee order, so a stale event can arrive after the one
	 * that superseded it (issue #54, same lesson as purchases.last_subscription_event_at).
	 */
	lastEventAt: integer('last_event_at'),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export type AccountSubscription = typeof accountSubscriptions.$inferSelect;
export type NewAccountSubscription = typeof accountSubscriptions.$inferInsert;
