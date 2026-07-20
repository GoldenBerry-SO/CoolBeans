// ABOUTME: The licenses table — the key itself and its lifecycle state (PRD §17).
// ABOUTME: status is binary (active|disabled); key is stored normalized (no dashes, uppercased).

import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { isoNow } from './columns.js';
import { products } from './products.js';
import { purchases } from './purchases.js';

export const licenses = pgTable(
	'licenses',
	{
		id: serial('id').primaryKey(),
		productId: integer('product_id')
			.notNull()
			.references(() => products.id),
		purchaseId: integer('purchase_id')
			.notNull()
			.references(() => purchases.id),
		key: text('key').notNull().unique(),
		tier: text('tier', { enum: ['lifetime', 'yearly', 'trial'] }).notNull(),
		status: text('status', { enum: ['active', 'disabled'] })
			.notNull()
			.default('active'),
		expiresAt: text('expires_at'),
		disabledAt: text('disabled_at'),
		disabledReason: text('disabled_reason', {
			enum: ['refund', 'subscription_canceled', 'manual', 'trial_expired', 'chargeback'],
		}),
		emailSentAt: text('email_sent_at'),
		createdAt: text('created_at').notNull().default(isoNow),
	},
	(t) => [
		check('ck_licenses_tier', sql`${t.tier} IN ('lifetime','yearly','trial')`),
		check('ck_licenses_status', sql`${t.status} IN ('active','disabled')`),
		// The active-licence count behind the plan cap reads exactly this pair.
		index('idx_licenses_product_status').on(t.productId, t.status),
	],
);

export type License = typeof licenses.$inferSelect;
export type NewLicense = typeof licenses.$inferInsert;
