// ABOUTME: The accounts table — the tenant that owns products and admin users (PRD §17).
// ABOUTME: `plan` is the effective plan limits read; Stripe bookkeeping lives in account_subscriptions.

import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable(
	'accounts',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		plan: text('plan', { enum: ['free', 'pro'] })
			.notNull()
			.default('free'),
		// Per-account overrides for the plan defaults. Null means "use the plan default",
		// which is how a support gesture (a raised cap for one customer) is expressed
		// without inventing a third plan.
		productLimit: integer('product_limit'),
		activeLicenseLimit: integer('active_license_limit'),
		// Set the first time a webhook issues a licence past the cap. Money had already
		// changed hands, so we issue and record rather than refuse; this drives the
		// console banner and the upgrade nudge.
		overLimitSince: text('over_limit_since'),
		createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	},
	(t) => [check('ck_accounts_plan', sql`${t.plan} IN ('free','pro')`)],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
