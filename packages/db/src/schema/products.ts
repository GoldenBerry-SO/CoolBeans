// ABOUTME: The products table — one row per product Cool Beans issues keys for (PRD §17).
// ABOUTME: Onboarding a product is an admin action; the key prefix resolves keys to their product.

import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const products = sqliteTable(
	'products',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		// The owning tenant. Deliberately declared without .references(): SQLite refuses a
		// non-NULL default on a column added with a REFERENCES clause while foreign_keys is
		// ON, and rebuilding this table is not an option because six others reference it.
		// node.ts asserts at boot that every account_id resolves. See drizzle/0010.
		accountId: integer('account_id').notNull().default(1),
		// Globally unique, not per-account: slug and key_prefix both appear in public URLs
		// (/v1/pubkey?product=, /v1/stripe/webhook/:product) and key_prefix is how the
		// public path resolves a key to its product without an account in hand.
		slug: text('slug').notNull().unique(),
		name: text('name').notNull(),
		keyPrefix: text('key_prefix').notNull().unique(),
		activationLimit: integer('activation_limit').notNull().default(3),
		activationModel: text('activation_model', { enum: ['node_locked', 'floating'] })
			.notNull()
			.default('node_locked'),
		floatingLeaseMinutes: integer('floating_lease_minutes').notNull().default(30),
		emailFrom: text('email_from').notNull(),
		downloadUrl: text('download_url'),
		stripePriceLifetime: text('stripe_price_lifetime'),
		stripePriceYearly: text('stripe_price_yearly'),
		stripeWebhookSecret: text('stripe_webhook_secret'),
		paypalPlanYearly: text('paypal_plan_yearly'),
		paypalSkuLifetime: text('paypal_sku_lifetime'),
		// SHA-256 hex of the per-product token (PRD §16): scopes the success-page
		// lookup without exposing the global admin token to landing sites.
		productTokenHash: text('product_token_hash'),
		// Archiving retires a product without deleting it: §9 is frozen, so issued keys
		// must keep validating forever. Null means live.
		archivedAt: text('archived_at'),
		createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	},
	(t) => [
		check('ck_products_activation_model', sql`${t.activationModel} IN ('node_locked','floating')`),
	],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
