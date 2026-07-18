// ABOUTME: The products table — one row per product Cool Beans issues keys for (PRD §17).
// ABOUTME: Onboarding a product is an admin action; the key prefix resolves keys to their product.

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const products = sqliteTable('products', {
	id: integer('id').primaryKey({ autoIncrement: true }),
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
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
