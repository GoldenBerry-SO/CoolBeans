// ABOUTME: Why a license is disabled, as a set rather than one column (PRD §13).
// ABOUTME: Two things can revoke at once; clearing one must not undo the other.

import { index, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { isoNow } from './columns.js';
import { licenses } from './licenses.js';

export const licenseRevocations = pgTable(
	'license_revocations',
	{
		id: serial('id').primaryKey(),
		licenseId: integer('license_id')
			.notNull()
			.references(() => licenses.id),
		/** Matches DisableReason: refund, subscription_canceled, manual, trial_expired, chargeback. */
		cause: text('cause').notNull(),
		/** Who or what applied it, e.g. stripe:evt_123. */
		actor: text('actor').notNull(),
		createdAt: text('created_at').notNull().default(isoNow),
		/** Set when the cause goes away (dispute won, subscription paid up). */
		clearedAt: text('cleared_at'),
	},
	(t) => [index('idx_license_revocations_open').on(t.licenseId, t.clearedAt)],
);

export type LicenseRevocation = typeof licenseRevocations.$inferSelect;
