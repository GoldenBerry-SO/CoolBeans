// ABOUTME: Console admin accounts + magic-code auth (PRD §16) — email OTP, no passwords.
// ABOUTME: Only hashes are stored for codes and session tokens; plaintext lives client-side only.

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const adminUsers = sqliteTable('admin_users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	email: text('email').notNull().unique(),
	name: text('name'),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	lastLoginAt: text('last_login_at'),
});

export const authCodes = sqliteTable(
	'auth_codes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		email: text('email').notNull(),
		codeHash: text('code_hash').notNull(),
		expiresAt: text('expires_at').notNull(),
		consumedAt: text('consumed_at'),
		attempts: integer('attempts').notNull().default(0),
		createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	},
	(t) => [index('idx_auth_codes_email').on(t.email)],
);

export const adminSessions = sqliteTable(
	'admin_sessions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tokenHash: text('token_hash').notNull().unique(),
		adminUserId: integer('admin_user_id')
			.notNull()
			.references(() => adminUsers.id),
		expiresAt: text('expires_at').notNull(),
		createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	},
	(t) => [index('idx_admin_sessions_user').on(t.adminUserId)],
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type AuthCode = typeof authCodes.$inferSelect;
export type AdminSession = typeof adminSessions.$inferSelect;
