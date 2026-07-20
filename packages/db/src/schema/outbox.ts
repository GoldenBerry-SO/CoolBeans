// ABOUTME: The outbox table — durable job queue source of truth for async work (PRD §14, background jobs).
// ABOUTME: BullMQ is the wakeup; a lost queue message is recovered by sweeping unprocessed outbox rows.

import { index, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { isoNow } from './columns.js';

export const outbox = pgTable(
	'outbox',
	{
		id: serial('id').primaryKey(),
		kind: text('kind').notNull(),
		payload: text('payload').notNull(),
		status: text('status', { enum: ['pending', 'processing', 'done', 'failed'] })
			.notNull()
			.default('pending'),
		attempts: integer('attempts').notNull().default(0),
		lastError: text('last_error'),
		claimedAt: text('claimed_at'),
		runAfter: text('run_after').notNull().default(isoNow),
		createdAt: text('created_at').notNull().default(isoNow),
		processedAt: text('processed_at'),
	},
	(t) => [index('idx_outbox_pending').on(t.status, t.runAfter)],
);

export type OutboxJob = typeof outbox.$inferSelect;
export type NewOutboxJob = typeof outbox.$inferInsert;
