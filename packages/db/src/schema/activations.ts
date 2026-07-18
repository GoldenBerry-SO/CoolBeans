// ABOUTME: The activations table — one row per device seat, exposed to clients as instance_id (PRD §17).
// ABOUTME: deactivated_at is a soft delete; a live seat is deactivated_at IS NULL.

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { licenses } from './licenses.js';

export const activations = sqliteTable(
	'activations',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		instanceId: text('instance_id').notNull().unique(),
		licenseId: integer('license_id')
			.notNull()
			.references(() => licenses.id),
		name: text('name').notNull(),
		createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
		lastValidatedAt: text('last_validated_at'),
		leaseExpiresAt: text('lease_expires_at'),
		deactivatedAt: text('deactivated_at'),
	},
	(t) => [index('idx_activations_live').on(t.licenseId).where(sql`${t.deactivatedAt} IS NULL`)],
);

export type Activation = typeof activations.$inferSelect;
export type NewActivation = typeof activations.$inferInsert;
