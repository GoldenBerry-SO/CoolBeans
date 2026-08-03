// ABOUTME: Outbound webhooks (issue #108) — vendor endpoints and their delivery log.
// ABOUTME: Deliveries ride the outbox for retries; the endpoint secret is stored encrypted.

import { index, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';
import { isoNow } from './columns.js';

export const webhookEndpoints = pgTable('webhook_endpoints', {
	id: serial('id').primaryKey(),
	// RESTRICT: an endpoint belongs to a tenant; deleting a populated account should fail
	// loudly rather than orphan its delivery history.
	accountId: integer('account_id')
		.notNull()
		.references(() => accounts.id, { onDelete: 'restrict' }),
	url: text('url').notNull(),
	/** JSON array of subscribed event types, e.g. ["license.issued","activation.created"]. */
	events: text('events').notNull(),
	/** HMAC signing secret, encrypted with the instance signing key secret. Shown once. */
	secret: text('secret').notNull(),
	// Disabled keeps the row and its delivery history; deliveries stop immediately.
	status: text('status', { enum: ['active', 'disabled'] })
		.notNull()
		.default('active'),
	createdAt: text('created_at').notNull().default(isoNow),
});

export const webhookDeliveries = pgTable(
	'webhook_deliveries',
	{
		id: serial('id').primaryKey(),
		endpointId: integer('endpoint_id')
			.notNull()
			.references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
		eventType: text('event_type').notNull(),
		/** The exact JSON body that was (or will be) POSTed, so the log shows what was sent. */
		payload: text('payload').notNull(),
		// pending until a 2xx lands; failed once the outbox gives up. Attempts and the last
		// error mirror the outbox so the console reads one row, not two tables.
		status: text('status', { enum: ['pending', 'delivered', 'failed'] })
			.notNull()
			.default('pending'),
		attempts: integer('attempts').notNull().default(0),
		lastError: text('last_error'),
		deliveredAt: text('delivered_at'),
		createdAt: text('created_at').notNull().default(isoNow),
	},
	(t) => [index('idx_webhook_deliveries_endpoint').on(t.endpointId, t.id)],
);

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
