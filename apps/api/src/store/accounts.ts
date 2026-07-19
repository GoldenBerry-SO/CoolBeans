// ABOUTME: Account data access — the tenant that owns products and admin users.
// ABOUTME: Also holds the boot check that stands in for the foreign keys SQLite would not take.

import type { Account, Database } from '@coolbeans/db';
import { accounts, adminUsers, products } from '@coolbeans/db';
import { count, eq, sql } from 'drizzle-orm';

/** The account every pre-tenancy row was backfilled onto, and the only one a self-host has. */
export const DEFAULT_ACCOUNT_ID = 1;

export function getAccountById(db: Database, id: number): Account | undefined {
	return db.select().from(accounts).where(eq(accounts.id, id)).get();
}

export function getAccountByName(db: Database, name: string): Account | undefined {
	return db.select().from(accounts).where(eq(accounts.name, name)).get();
}

export function listAccounts(db: Database): Account[] {
	return db.select().from(accounts).all();
}

export function countAccounts(db: Database): number {
	return db.select({ n: count() }).from(accounts).get()?.n ?? 0;
}

export function createAccount(db: Database, name: string): Account {
	return db.insert(accounts).values({ name }).returning().get();
}

/**
 * products.account_id and admin_users.account_id carry no REFERENCES clause, because
 * SQLite will not take a non-NULL default on an added foreign-key column and rebuilding
 * products is unsafe while six tables point at it. This is the check that would otherwise
 * have been the constraint; node.ts runs it at boot so a broken backfill surfaces there
 * rather than as a cross-tenant read months later.
 */
export function findOrphanedRows(db: Database): { table: string; accountId: number }[] {
	const orphans: { table: string; accountId: number }[] = [];
	for (const [table, column] of [
		['products', products.accountId],
		['admin_users', adminUsers.accountId],
	] as const) {
		const rows = db
			.selectDistinct({ accountId: column })
			.from(table === 'products' ? products : adminUsers)
			.where(sql`${column} NOT IN (SELECT ${accounts.id} FROM ${accounts})`)
			.all();
		for (const row of rows) orphans.push({ table, accountId: row.accountId });
	}
	return orphans;
}

/** Throws when any product or admin names an account that does not exist. */
export function assertAccountsResolve(db: Database): void {
	const orphans = findOrphanedRows(db);
	if (orphans.length === 0) return;
	const detail = orphans.map((o) => `${o.table} → account ${o.accountId}`).join(', ');
	throw new Error(`Rows reference an account that does not exist: ${detail}`);
}
