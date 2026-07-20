// ABOUTME: The provider_events and audit_log tables — webhook dedupe and the state-change trail (PRD §16, §17).
// ABOUTME: provider_events doubles as the payment audit trail; audit_log records every state change with its actor.

import { index, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';
import { isoNow } from './columns.js';

export const providerEvents = pgTable('provider_events', {
	id: text('id').primaryKey(),
	// Nullable: an event can fail signature or price checks before any product, and so any
	// account, is known. /admin/events shows an account only its own rows.
	// SQLite could not add a foreign key to an existing table, so this was ungated until now.
	// SET NULL: this column is nullable by design (an event is attributed to an account at
	// claim time, and may arrive before that is known), so the reference must not force a value.
	accountId: integer('account_id').references(() => accounts.id, { onDelete: 'set null' }),
	provider: text('provider').notNull(),
	type: text('type').notNull(),
	// 'processing' while a handler owns the event, 'done' once it fully succeeded.
	// A row is deleted when a handler fails so the provider's retry can re-enter.
	status: text('status', { enum: ['processing', 'done'] })
		.notNull()
		.default('done'),
	claimedAt: text('claimed_at'),
	receivedAt: text('received_at').notNull().default(isoNow),
});

export const auditLog = pgTable(
	'audit_log',
	{
		id: serial('id').primaryKey(),
		// Carried directly rather than derived through product_id, because sign-in, invite
		// and account rows have no product and could not otherwise be scoped.
		// SQLite could not add a foreign key to an existing table, so this was ungated until now.
		// RESTRICT: audit rows carry customer data, so deleting a populated account should
		// fail loudly rather than silently drop its history.
		accountId: integer('account_id')
			.notNull()
			.default(1)
			.references(() => accounts.id, { onDelete: 'restrict' }),
		productId: integer('product_id'),
		actor: text('actor'),
		action: text('action').notNull(),
		licenseId: integer('license_id'),
		detail: text('detail'),
		createdAt: text('created_at').notNull().default(isoNow),
	},
	(t) => [index('idx_audit_account').on(t.accountId, t.id)],
);

export type ProviderEvent = typeof providerEvents.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
