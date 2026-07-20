// ABOUTME: Terminal payment events that arrived before the purchase they refer to (PRD §13).
// ABOUTME: Stripe does not guarantee delivery order, so a refund can land before its checkout.

import { pgTable, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { isoNow } from './columns.js';

export const pendingRevocations = pgTable(
	'pending_revocations',
	{
		id: serial('id').primaryKey(),
		provider: text('provider', { enum: ['stripe', 'paypal'] })
			.notNull()
			.default('stripe'),
		/** The payment intent or subscription id the terminal event named. */
		reference: text('reference').notNull(),
		reason: text('reason').notNull(),
		eventId: text('event_id').notNull(),
		createdAt: text('created_at').notNull().default(isoNow),
		consumedAt: text('consumed_at'),
	},
	// One row per (reference, cause). Keying on the reference alone let a dispute and a
	// refund for the same payment share a row, so clearing the dispute threw away the
	// refund too. A redelivery of the same cause still collapses into one row.
	(t) => [uniqueIndex('idx_pending_revocations_ref').on(t.provider, t.reference, t.reason)],
);

export type PendingRevocation = typeof pendingRevocations.$inferSelect;
export type NewPendingRevocation = typeof pendingRevocations.$inferInsert;
