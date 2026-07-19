// ABOUTME: The provider_events and audit_log tables — webhook dedupe and the state-change trail (PRD §16, §17).
// ABOUTME: provider_events doubles as the payment audit trail; audit_log records every state change with its actor.

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const providerEvents = sqliteTable('provider_events', {
	id: text('id').primaryKey(),
	// Nullable: an event can fail signature or price checks before any product, and so any
	// account, is known. /admin/events shows an account only its own rows.
	accountId: integer('account_id'),
	provider: text('provider').notNull(),
	type: text('type').notNull(),
	// 'processing' while a handler owns the event, 'done' once it fully succeeded.
	// A row is deleted when a handler fails so the provider's retry can re-enter.
	status: text('status', { enum: ['processing', 'done'] })
		.notNull()
		.default('done'),
	claimedAt: text('claimed_at'),
	receivedAt: text('received_at').notNull().default(sql`(datetime('now'))`),
});

export const auditLog = sqliteTable(
	'audit_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		// Carried directly rather than derived through product_id, because sign-in, invite
		// and account rows have no product and could not otherwise be scoped.
		accountId: integer('account_id').notNull().default(1),
		productId: integer('product_id'),
		actor: text('actor'),
		action: text('action').notNull(),
		licenseId: integer('license_id'),
		detail: text('detail'),
		createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	},
	(t) => [index('idx_audit_account').on(t.accountId, t.id)],
);

export type ProviderEvent = typeof providerEvents.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
