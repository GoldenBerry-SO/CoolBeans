// ABOUTME: One-shot CSRF state for the Stripe Connect authorization handshake (issue #62 cloud).
// ABOUTME: Binds a callback to the account that started it; single use, short lived.

import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';
import { isoNow } from './columns.js';

export const stripeConnectStates = pgTable(
	'stripe_connect_states',
	{
		id: serial('id').primaryKey(),
		accountId: integer('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		// The `state` Stripe echoes back, stored hashed: it is a bearer value for the duration
		// of the handshake, and §19 says a credential is never stored in the clear.
		stateHash: text('state_hash').notNull().unique(),
		expiresAt: text('expires_at').notNull(),
		// Stamped the moment it is redeemed, so a replayed callback finds it spent.
		consumedAt: text('consumed_at'),
		createdAt: text('created_at').notNull().default(isoNow),
	},
	(t) => [
		check('ck_stripe_connect_states_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
		index('idx_stripe_connect_states_account').on(t.accountId),
	],
);

export type StripeConnectState = typeof stripeConnectStates.$inferSelect;
export type NewStripeConnectState = typeof stripeConnectStates.$inferInsert;
