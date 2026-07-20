// ABOUTME: The Postgres the test suite runs on — PGlite, real Postgres 16 compiled to WASM.
// ABOUTME: One instance per test file, reset between harnesses; no Docker, no server, real SQL.

import { MIGRATIONS_FOLDER, schema } from '@coolbeans/db';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

/**
 * PGlite rather than a container because the numbers are decisive: a fresh instance costs
 * ~975ms, so one per harness would put ~7 minutes of pure setup on the suite. Migrating
 * once per file and truncating between harnesses costs ~22ms each, which keeps the suite
 * roughly where it was on SQLite.
 *
 * What PGlite cannot do is concurrency: it is a single connection in one process. Anything
 * asserting that a cap holds under real contention belongs in the race suite, which runs
 * against a genuine server. Never let a capped path be covered only from here.
 */
let instance: { client: PGlite; db: PgliteDatabase<typeof schema> } | null = null;

/** Tables to empty between harnesses, discovered rather than listed so the schema can move. */
let truncatable: string[] | null = null;

async function tablesToTruncate(client: PGlite): Promise<string[]> {
	if (truncatable) return truncatable;
	const res = await client.query<{ table_name: string }>(
		`SELECT table_name FROM information_schema.tables
		 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
	);
	// Only the public schema, so drizzle's own migration bookkeeping (which lives in the
	// drizzle schema) is excluded for free — truncating that would re-run every migration.
	truncatable = res.rows.map((r) => `"${r.table_name}"`);
	return truncatable;
}

/**
 * Empty every table and restore the seed the migration provides.
 *
 * RESTART IDENTITY matters as much as the truncation: tests assert on specific ids, and a
 * counter that kept climbing between harnesses would make them pass or fail depending on
 * what ran before them.
 */
async function reset(client: PGlite): Promise<void> {
	const tables = await tablesToTruncate(client);
	await client.exec(`
		TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE;
		INSERT INTO "accounts" ("id", "name", "plan") VALUES (1, 'Default account', 'pro');
		SELECT setval('accounts_id_seq', 1, true);
	`);
}

/** A migrated, empty database with the default account present. */
export async function testDatabase() {
	if (!instance) {
		const client = new PGlite();
		const db = drizzle(client, { schema });
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
		instance = { client, db };
		return db;
	}
	await reset(instance.client);
	return instance.db;
}

/**
 * Raw SQL against the current test database, for tests that deliberately bypass the ORM.
 *
 * The old suite reached for `db.$client.prepare(...)` — better-sqlite3's API, which no
 * Postgres driver has, and which the shared `Database` type rightly does not expose. Tests
 * that want to check what is *actually in the table*, independent of the query builder
 * under test, go through here instead.
 */
export async function rawQuery<T = Record<string, unknown>>(
	text: string,
	params: unknown[] = [],
): Promise<T[]> {
	if (!instance) throw new Error('rawQuery before testDatabase(): make a harness first.');
	const res = await instance.client.query<T>(text, params);
	return res.rows;
}

/** Raw multi-statement SQL, for test fixtures that set up state wholesale. */
export async function rawExec(text: string): Promise<void> {
	if (!instance) throw new Error('rawExec before testDatabase(): make a harness first.');
	await instance.client.exec(text);
}
