// ABOUTME: Console admin accounts + magic-code auth (PRD §16) — email OTP, no passwords.
// ABOUTME: Only hashes are stored for codes and session tokens; plaintext lives client-side only.

import { index, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';
import { isoNow } from './columns.js';

export const adminUsers = pgTable('admin_users', {
	id: serial('id').primaryKey(),
	// SQLite could not add a foreign key to an existing table, so this was ungated until now.
	// RESTRICT: admin users carry customer-facing identity, so deleting a populated account
	// should fail loudly rather than silently orphan them.
	accountId: integer('account_id')
		.notNull()
		.default(1)
		.references(() => accounts.id, { onDelete: 'restrict' }),
	// Globally unique, so one person belongs to exactly one account. requestCode looks up
	// by email alone with no account context available, so per-account emails would need
	// an account picker before we know who is signing in. account_id on admin_sessions is
	// what makes a future account_members table cheap.
	email: text('email').notNull().unique(),
	name: text('name'),
	createdAt: text('created_at').notNull().default(isoNow),
	lastLoginAt: text('last_login_at'),
});

export const authCodes = pgTable(
	'auth_codes',
	{
		id: serial('id').primaryKey(),
		email: text('email').notNull(),
		codeHash: text('code_hash').notNull(),
		expiresAt: text('expires_at').notNull(),
		consumedAt: text('consumed_at'),
		attempts: integer('attempts').notNull().default(0),
		createdAt: text('created_at').notNull().default(isoNow),
	},
	(t) => [index('idx_auth_codes_email').on(t.email)],
);

export const adminSessions = pgTable(
	'admin_sessions',
	{
		id: serial('id').primaryKey(),
		tokenHash: text('token_hash').notNull().unique(),
		// The tenant is carried by the credential, not the person: scoping reads the
		// session, so one human in two accounts later needs no change to the scoping code.
		// SQLite could not add a foreign key to an existing table, so this was ungated until now.
		// CASCADE: a session is worthless without its account, so it should go with it.
		accountId: integer('account_id')
			.notNull()
			.default(1)
			.references(() => accounts.id, { onDelete: 'cascade' }),
		adminUserId: integer('admin_user_id')
			.notNull()
			.references(() => adminUsers.id),
		expiresAt: text('expires_at').notNull(),
		createdAt: text('created_at').notNull().default(isoNow),
	},
	(t) => [index('idx_admin_sessions_user').on(t.adminUserId)],
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type AuthCode = typeof authCodes.$inferSelect;
export type AdminSession = typeof adminSessions.$inferSelect;
