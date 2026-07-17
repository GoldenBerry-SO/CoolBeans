// ABOUTME: Storage adapter seam — one Database type behind a factory, drivers stay in here.
// ABOUTME: SQLite (better-sqlite3) for dev/self-host; the Postgres adapter is tracked as an issue.

import type Sqlite from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index.js';

export function createDb(client: Sqlite.Database) {
	return drizzleSqlite(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

export * from './schema/index.js';
