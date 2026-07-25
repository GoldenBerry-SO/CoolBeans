// ABOUTME: A grant maps one Stripe price to a licence rule (issue #62) — the whole pricing model.
// ABOUTME: perpetual issues a never-expiring key; subscription tracks the Stripe period end.

import { sql } from 'drizzle-orm';
import {
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	serial,
	text,
	unique,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';
import { isoNow } from './columns.js';
import { products } from './products.js';
import { stripeConnections } from './stripe-connections.js';

export const licenseGrants = pgTable(
	'license_grants',
	{
		id: serial('id').primaryKey(),
		accountId: integer('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'restrict' }),
		stripeConnectionId: integer('stripe_connection_id').notNull(),
		stripePriceId: text('stripe_price_id').notNull(),
		productId: integer('product_id').notNull(),
		kind: text('kind', { enum: ['perpetual', 'subscription'] }).notNull(),
		// The vendor's free-form plan label, snapshotted onto every licence this grant issues.
		plan: text('plan'),
		// Seats this price buys. NULL inherits the product's limit, which is what every grant did
		// before: a grant already says what duration and what name a price buys, so how MANY it
		// buys belongs here too. Without it one product cannot sell Basic 3 seats and Pro 10.
		activationLimit: integer('activation_limit'),
		// Retired means "issue no new licences", not "erase history": a grant referenced by a
		// licence stays resolvable for audit. Editing a price or kind means retire + recreate.
		status: text('status', { enum: ['active', 'retired'] })
			.notNull()
			.default('active'),
		retiredAt: text('retired_at'),
		createdAt: text('created_at').notNull().default(isoNow),
	},
	(t) => [
		check('ck_license_grants_kind', sql`${t.kind} IN ('perpetual','subscription')`),
		check('ck_license_grants_status', sql`${t.status} IN ('active','retired')`),
		check('ck_license_grants_seats', sql`${t.activationLimit} IS NULL OR ${t.activationLimit} > 0`),
		// A price is unambiguous within one Stripe connection: one grant resolves a checkout.
		unique('uq_license_grants_connection_price').on(t.stripeConnectionId, t.stripePriceId),
		index('idx_license_grants_product_status').on(t.productId, t.status),
		// Tenant FKs: a grant can only wire a connection and a product that belong to the SAME
		// account, enforced in the database. A grant crossing tenants is impossible, not merely
		// checked in application code.
		foreignKey({
			columns: [t.accountId, t.stripeConnectionId],
			foreignColumns: [stripeConnections.accountId, stripeConnections.id],
			name: 'fk_license_grants_connection',
		}).onDelete('restrict'),
		foreignKey({
			columns: [t.accountId, t.productId],
			foreignColumns: [products.accountId, products.id],
			name: 'fk_license_grants_product',
		}).onDelete('restrict'),
	],
);

export type LicenseGrant = typeof licenseGrants.$inferSelect;
export type NewLicenseGrant = typeof licenseGrants.$inferInsert;
