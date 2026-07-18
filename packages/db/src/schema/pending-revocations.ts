// ABOUTME: Terminal payment events that arrived before the purchase they refer to (PRD §13).
// ABOUTME: Stripe does not guarantee delivery order, so a refund can land before its checkout.

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const pendingRevocations = sqliteTable(
	'pending_revocations',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		provider: text('provider', { enum: ['stripe', 'paypal'] })
			.notNull()
			.default('stripe'),
		/** The payment intent or subscription id the terminal event named. */
		reference: text('reference').notNull(),
		reason: text('reason').notNull(),
		eventId: text('event_id').notNull(),
		createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
		consumedAt: text('consumed_at'),
	},
	// One row per reference: a redelivered refund must not stack up claims.
	(t) => [uniqueIndex('idx_pending_revocations_ref').on(t.provider, t.reference)],
);

export type PendingRevocation = typeof pendingRevocations.$inferSelect;
export type NewPendingRevocation = typeof pendingRevocations.$inferInsert;
