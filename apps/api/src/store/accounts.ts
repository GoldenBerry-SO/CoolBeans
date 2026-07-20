// ABOUTME: Account data access — the tenant that owns products and admin users.
// ABOUTME: Also holds the boot check that stands in for the foreign keys SQLite would not take.

import type { Account, Database } from '@coolbeans/db';
import { accounts, adminUsers, products } from '@coolbeans/db';
import { count, eq, sql } from 'drizzle-orm';

/** The account every pre-tenancy row was backfilled onto, and the only one a self-host has. */
export const DEFAULT_ACCOUNT_ID = 1;

export async function getAccountById(db: Database, id: number): Promise<Account | undefined> {
	const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
	return row;
}

/**
 * Accounts by name. Names are NOT unique — two signups from the same email domain both
 * default to that domain — so this returns every match and the caller decides. Anything
 * that picked "the first" would silently act on an arbitrary tenant.
 */
export async function findAccountsByName(db: Database, name: string): Promise<Account[]> {
	return await db.select().from(accounts).where(eq(accounts.name, name));
}

export async function listAccounts(db: Database): Promise<Account[]> {
	return await db.select().from(accounts);
}

export async function countAccounts(db: Database): Promise<number> {
	const [row] = await db.select({ n: count() }).from(accounts);
	return row?.n ?? 0;
}

export async function createAccount(db: Database, name: string): Promise<Account> {
	const [row] = await db.insert(accounts).values({ name }).returning();
	return row;
}

/**
 * products.account_id and admin_users.account_id carry no REFERENCES clause, because
 * SQLite will not take a non-NULL default on an added foreign-key column and rebuilding
 * products is unsafe while six tables point at it. This is the check that would otherwise
 * have been the constraint; node.ts runs it at boot so a broken backfill surfaces there
 * rather than as a cross-tenant read months later.
 */
export async function findOrphanedRows(
	db: Database,
): Promise<{ table: string; accountId: number }[]> {
	const orphans: { table: string; accountId: number }[] = [];
	for (const [table, column] of [
		['products', products.accountId],
		['admin_users', adminUsers.accountId],
	] as const) {
		const rows = await db
			.selectDistinct({ accountId: column })
			.from(table === 'products' ? products : adminUsers)
			.where(sql`${column} NOT IN (SELECT ${accounts.id} FROM ${accounts})`);
		for (const row of rows) orphans.push({ table, accountId: row.accountId });
	}
	return orphans;
}

/** Throws when any product or admin names an account that does not exist. */
export async function assertAccountsResolve(db: Database): Promise<void> {
	const orphans = await findOrphanedRows(db);
	if (orphans.length === 0) return;
	const detail = orphans.map((o) => `${o.table} → account ${o.accountId}`).join(', ');
	throw new Error(`Rows reference an account that does not exist: ${detail}`);
}
