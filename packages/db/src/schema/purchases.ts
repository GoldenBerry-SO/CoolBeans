// ABOUTME: The purchases table — the payment event that produced a license (PRD §17).
// ABOUTME: provider_checkout_id is UNIQUE so issuance can never double-fire across the success-page race.

import { index, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { isoNow } from './columns.js';
import { products } from './products.js';

export const purchases = pgTable(
	'purchases',
	{
		id: serial('id').primaryKey(),
		productId: integer('product_id')
			.notNull()
			.references(() => products.id),
		provider: text('provider', { enum: ['stripe', 'paypal', 'manual'] })
			.notNull()
			.default('stripe'),
		providerCheckoutId: text('provider_checkout_id').unique(),
		providerCustomerId: text('provider_customer_id'),
		providerSubscriptionId: text('provider_subscription_id'),
		providerPaymentId: text('provider_payment_id'),
		email: text('email').notNull(),
		amountTotal: integer('amount_total'),
		currency: text('currency'),
		note: text('note'),
		/**
		 * `created` of the newest subscription event we have applied, in unix seconds.
		 * Stripe retries, so a stale event can arrive after the one that superseded it.
		 */
		lastSubscriptionEventAt: integer('last_subscription_event_at'),
		createdAt: text('created_at').notNull().default(isoNow),
	},
	(t) => [
		index('idx_purchases_subscription').on(t.providerSubscriptionId),
		index('idx_purchases_payment').on(t.providerPaymentId),
	],
);

export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;
