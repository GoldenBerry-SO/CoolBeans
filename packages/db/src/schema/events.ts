// ABOUTME: The provider_events and audit_log tables — webhook dedupe and the state-change trail (PRD §16, §17).
// ABOUTME: provider_events doubles as the payment audit trail; audit_log records every state change with its actor.

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const providerEvents = sqliteTable('provider_events', {
	id: text('id').primaryKey(),
	provider: text('provider').notNull(),
	type: text('type').notNull(),
	receivedAt: text('received_at').notNull().default(sql`(datetime('now'))`),
});

export const auditLog = sqliteTable('audit_log', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	productId: integer('product_id'),
	actor: text('actor'),
	action: text('action').notNull(),
	licenseId: integer('license_id'),
	detail: text('detail'),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type ProviderEvent = typeof providerEvents.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
