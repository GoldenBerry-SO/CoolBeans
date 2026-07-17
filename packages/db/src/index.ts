// ABOUTME: Storage adapter seam — one Database type, two factories (better-sqlite3 and D1).
// ABOUTME: Routes and services depend only on the Database type, never on a driver.

import type { D1Database } from '@cloudflare/workers-types';
import type Sqlite from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import * as schema from './schema/index.js';

export function createDbSqlite(client: Sqlite.Database) {
	return drizzleSqlite(client, { schema });
}

export function createDbD1(d1: D1Database) {
	return drizzleD1(d1, { schema });
}

export type Database = ReturnType<typeof createDbSqlite> | ReturnType<typeof createDbD1>;

export * from './schema/index.js';
