// ABOUTME: Storage adapter seam — one Database type behind a factory, drivers stay in here.
// ABOUTME: SQLite (better-sqlite3) is the current adapter; Postgres remains a planned async port.

import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema/index.js';

export type CoolBeansDb = ReturnType<typeof createDb>;
export type { CoolBeansDb as Database };

/** Wrap an open better-sqlite3 connection in a Drizzle client bound to our schema. */
export function createDb(client: Database.Database) {
	client.pragma('journal_mode = WAL');
	client.pragma('foreign_keys = ON');
	return drizzle(client, { schema });
}

/** Open a better-sqlite3 file (or ':memory:') and return the raw connection. */
export function openSqlite(path: string): Database.Database {
	return new Database(path);
}

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Apply any pending migrations. A no-op when the DB is already current. */
export function migrate(db: CoolBeansDb): void {
	migrateSqlite(db, { migrationsFolder });
}

export * from './schema/index.js';
