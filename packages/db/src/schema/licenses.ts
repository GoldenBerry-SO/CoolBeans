// ABOUTME: The licenses table — the key itself and its lifecycle state (PRD §17).
// ABOUTME: status is binary (active|disabled); key is stored normalized (no dashes, uppercased).

import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { products } from './products.js';
import { purchases } from './purchases.js';

export const licenses = sqliteTable(
	'licenses',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
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
		createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	},
	(t) => [
		check('ck_licenses_tier', sql`${t.tier} IN ('lifetime','yearly','trial')`),
		check('ck_licenses_status', sql`${t.status} IN ('active','disabled')`),
	],
);

export type License = typeof licenses.$inferSelect;
export type NewLicense = typeof licenses.$inferInsert;
