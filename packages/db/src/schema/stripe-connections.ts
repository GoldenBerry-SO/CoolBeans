// ABOUTME: A vendor's connected Stripe account (issue #62 redesign) — one abstraction, two modes.
// ABOUTME: Cloud uses Stripe Connect (one per account); self-host seeds a single default from config.

import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, serial, text, unique } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';
import { isoNow } from './columns.js';

export const stripeConnections = pgTable(
	'stripe_connections',
	{
		id: serial('id').primaryKey(),
		accountId: integer('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'restrict' }),
		provider: text('provider', { enum: ['stripe'] })
			.notNull()
			.default('stripe'),
		// cloud_connect: a Stripe Connect Standard account authorized by the vendor.
		// self_host_default: the single account the instance's own STRIPE_* credential owns.
		mode: text('mode', { enum: ['cloud_connect', 'self_host_default'] }).notNull(),
		// The vendor's Stripe account id (acct_...). Price ids only mean anything within it.
		stripeAccountId: text('stripe_account_id').notNull(),
		livemode: boolean('livemode').notNull().default(false),
		status: text('status', { enum: ['active', 'disconnected', 'disabled'] })
			.notNull()
			.default('active'),
		// The per-connection webhook signing secret. Cloud verifies Connect events with the
		// platform secret instead, so this stays null there.
		webhookSecret: text('webhook_secret'),
		createdAt: text('created_at').notNull().default(isoNow),
	},
	(t) => [
		check('ck_stripe_connections_mode', sql`${t.mode} IN ('cloud_connect','self_host_default')`),
		check('ck_stripe_connections_status', sql`${t.status} IN ('active','disconnected','disabled')`),
		// A Stripe account can back exactly one Cool Beans tenant, so an event's signed
		// account resolves to one connection and can never issue under another tenant.
		unique('uq_stripe_connections_account').on(t.stripeAccountId),
		// Composite unique so license_grants can reference (account_id, id) as a tenant FK.
		unique('uq_stripe_connections_tenant').on(t.accountId, t.id),
	],
);

export type StripeConnection = typeof stripeConnections.$inferSelect;
export type NewStripeConnection = typeof stripeConnections.$inferInsert;
