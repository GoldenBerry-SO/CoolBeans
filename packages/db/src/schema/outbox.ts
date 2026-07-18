// ABOUTME: The outbox table — durable job queue source of truth for async work (PRD §14, background jobs).
// ABOUTME: BullMQ is the wakeup; a lost queue message is recovered by sweeping unprocessed outbox rows.

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const outbox = sqliteTable(
	'outbox',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		kind: text('kind').notNull(),
		payload: text('payload').notNull(),
		status: text('status', { enum: ['pending', 'processing', 'done', 'failed'] })
			.notNull()
			.default('pending'),
		attempts: integer('attempts').notNull().default(0),
		lastError: text('last_error'),
		claimedAt: text('claimed_at'),
		runAfter: text('run_after').notNull().default(sql`(datetime('now'))`),
		createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
		processedAt: text('processed_at'),
	},
	(t) => [index('idx_outbox_pending').on(t.status, t.runAfter)],
);

export type OutboxJob = typeof outbox.$inferSelect;
export type NewOutboxJob = typeof outbox.$inferInsert;
