// ABOUTME: The licenses table — the key itself and its lifecycle state (PRD §17).
// ABOUTME: status is binary (active|disabled); key is stored normalized (no dashes, uppercased).

import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { isoNow } from './columns.js';
import { licenseGrants } from './license-grants.js';
import { products } from './products.js';
import { purchases } from './purchases.js';

export const licenses = pgTable(
	'licenses',
	{
		id: serial('id').primaryKey(),
		productId: integer('product_id')
			.notNull()
			.references(() => products.id),
		purchaseId: integer('purchase_id')
			.notNull()
			.references(() => purchases.id),
		key: text('key').notNull().unique(),
		// The lifecycle shape of the entitlement, not the vendor's pricing. 'perpetual' never
		// expires, 'subscription' tracks a Stripe period end, 'trial' is a fixed window. The
		// vendor's own label (e.g. "Pro monthly") is the free-form, display-only `plan`.
		kind: text('kind', { enum: ['perpetual', 'subscription', 'trial'] }).notNull(),
		plan: text('plan'),
		// Snapshotted from the grant at issuance so a later re-price never silently changes what
		// somebody already bought. NULL inherits the product's limit.
		activationLimit: integer('activation_limit'),
		// The grant that issued this licence (null for trials and manual issues, which have
		// no Stripe price behind them). Immutable provenance: answers "which rule made this key".
		issuedGrantId: integer('issued_grant_id').references(() => licenseGrants.id),
		status: text('status', { enum: ['active', 'disabled'] })
			.notNull()
			.default('active'),
		expiresAt: text('expires_at'),
		disabledAt: text('disabled_at'),
		disabledReason: text('disabled_reason', {
			enum: ['refund', 'subscription_canceled', 'manual', 'trial_expired', 'chargeback'],
		}),
		emailSentAt: text('email_sent_at'),
		createdAt: text('created_at').notNull().default(isoNow),
	},
	(t) => [
		check('ck_licenses_kind', sql`${t.kind} IN ('perpetual','subscription','trial')`),
		check('ck_licenses_status', sql`${t.status} IN ('active','disabled')`),
		check('ck_licenses_seats', sql`${t.activationLimit} IS NULL OR ${t.activationLimit} > 0`),
		// The kind decides whether an expiry exists, so the database says so too. A subscription
		// or trial row with a NULL expiry never expires, which hands a monthly customer a
		// perpetual key and lets the SDK grant offline grace forever; a perpetual row WITH an
		// expiry cuts off someone who bought it outright. Application code gets this right, and
		// this is the constraint that keeps it right.
		check(
			'ck_licenses_expiry_matches_kind',
			sql`(${t.kind} = 'perpetual' AND ${t.expiresAt} IS NULL)
			 OR (${t.kind} IN ('subscription','trial') AND ${t.expiresAt} IS NOT NULL)`,
		),
		// The active-licence count behind the plan cap reads exactly this pair.
		index('idx_licenses_product_status').on(t.productId, t.status),
	],
);

export type License = typeof licenses.$inferSelect;
export type NewLicense = typeof licenses.$inferInsert;
