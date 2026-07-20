// ABOUTME: Storage adapter seam — one Database type behind a factory, drivers stay in here.
// ABOUTME: PostgreSQL via postgres-js; no driver-specific result shape escapes this file.

import { fileURLToPath } from 'node:url';
import { type ExtractTablesWithRelations, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema/index.js';

/**
 * A Postgres database bound to our schema, stated at the dialect level rather than the
 * driver level, with the driver's raw result type left open.
 *
 * Deliberately not `PostgresJsDatabase`: the test suite runs the same code against PGlite
 * (real Postgres, in-process) and production runs postgres-js. Both extend `PgDatabase`, so
 * naming the driver here would mean either a cast in every test or a second seam that could
 * drift from the one that ships.
 *
 * `PgDatabase` is invariant in this parameter, so naming `PostgresJsQueryResultHKT` here
 * would make a PGlite database fail to assign, and naming PGlite's would do the reverse.
 * Nothing in the application ever touches a raw driver result — everything goes through
 * the query builders and through `applied()`/`affected()`, which read RETURNING rows. So
 * this is the one place the two drivers are allowed to differ, and widening it here is
 * what keeps a single seam instead of a production type and a parallel test type that can
 * drift apart.
 */
// biome-ignore lint/suspicious/noExplicitAny: see above — invariance in the driver HKT.
type AnyPgResult = any;

export type CoolBeansDb = PgDatabase<
	AnyPgResult,
	typeof schema,
	ExtractTablesWithRelations<typeof schema>
>;
export type { CoolBeansDb as Database };

/**
 * Anything a statement can run on: the pool, or a transaction.
 *
 * Every helper that writes takes this rather than the pool specifically. That is what makes
 * it impossible to accidentally write outside an enclosing transaction — a helper reached
 * through a transaction-bound deps bundle simply cannot see the pool.
 */
export type DbHandle = CoolBeansDb | Parameters<Parameters<CoolBeansDb['transaction']>[0]>[0];

export type CoolBeansPool = ReturnType<typeof createPool>;

export function createPool(url: string, opts: { max?: number } = {}) {
	return postgres(url, {
		max: opts.max ?? 10,
		// Required the moment anything fronts the cluster with a transaction-mode pooler:
		// there is no session to hold a prepared statement across.
		prepare: false,
		// Drizzle surfaces its own errors; NOTICE chatter here is just noise in pod logs.
		onnotice: () => {},
	});
}

/** Wrap an open postgres-js pool in a Drizzle client bound to our schema. */
export function createDb(client: CoolBeansPool): PostgresJsDatabase<typeof schema> {
	return drizzle(client, { schema });
}

/** Where the migration SQL lives, for anything that needs to apply it (the CLI, tests). */
export const MIGRATIONS_FOLDER: string = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Apply any pending migrations. A no-op when the database is already current.
 *
 * Deliberately NOT called at server boot. With more than one replica that is a race over
 * DDL; migrate-cli.ts is the single place it runs, and assertSchemaCurrent is what boot
 * does instead.
 */
export async function migrate(db: PostgresJsDatabase<typeof schema>): Promise<void> {
	await migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/**
 * The RETURNING rows behind a raw `db.execute()` result, whichever driver produced it.
 *
 * The two drivers disagree on the container: postgres-js hands back an array (a RowList),
 * PGlite hands back `{ rows, fields, affectedRows }`. Verified empirically — an
 * `INSERT ... RETURNING` on PGlite is `{ rows: [{id: 1}], ... }`, not an array. Without
 * this normalisation every guarded statement would throw in the test suite and work in
 * production, which is precisely the split this module exists to prevent.
 *
 * `affectedRows` is deliberately NOT read, even though PGlite offers it. Rowcounts are the
 * trap: `result.changes` was better-sqlite3's spelling, and code that reads a count field
 * silently stops enforcing its cap on the driver that spells it differently. RETURNING
 * rows are the one shape every driver agrees to produce only when the statement applied.
 */
function returningRows(result: unknown): unknown[] | null {
	if (Array.isArray(result)) return result;
	if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
		return (result as { rows: unknown[] }).rows;
	}
	return null;
}

/**
 * Refuse to serve a schema this build was not made for.
 *
 * Boot no longer migrates: with N replicas plus a worker plus the migration Job, boot-time
 * DDL is a race. This is what boot does instead — it compares the migrations the database
 * has actually applied against the journal this build shipped with, and throws with the
 * counts when they disagree. The migration Job (migrate-cli.ts) is the only writer;
 * MIGRATE_ON_BOOT=true restores the old single-container behaviour for self-hosters who
 * genuinely run one process.
 */
export async function assertSchemaCurrent(db: CoolBeansDb): Promise<void> {
	const { readFileSync } = await import('node:fs');
	const { join } = await import('node:path');
	const journal = JSON.parse(
		readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
	) as {
		entries: { tag: string }[];
	};
	const expected = journal.entries.length;

	let appliedCount: number;
	try {
		const result = await db.execute(
			sql`SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations`,
		);
		const rows = returningRows(result) as Array<{ n: number }> | null;
		appliedCount = rows?.[0]?.n ?? 0;
	} catch {
		throw new Error(
			`This database has no migrations applied at all (expected ${expected}). Run the migration job (db:migrate) before starting the server, or set MIGRATE_ON_BOOT=true on a single-process self-host.`,
		);
	}
	if (appliedCount < expected) {
		const missing = journal.entries.slice(appliedCount).map((e) => e.tag);
		throw new Error(
			`Database schema is behind this build: ${appliedCount}/${expected} migrations applied, missing ${missing.join(', ')}. Run the migration job (db:migrate) first.`,
		);
	}
}

/**
 * Did a guarded statement apply?
 *
 * Reads RETURNING rows, never a driver rowcount. `result.changes` is a better-sqlite3
 * field; postgres-js has no such property, and reading it would yield `undefined`. Since
 * `undefined === 0` is false, every `if (result.changes === 0) throw` would simply stop
 * throwing and the cap it guards would silently stop being enforced. Nothing would log.
 *
 * Throws rather than returning false on an unrecognised shape, so the same mistake made in
 * the other direction is loud instead of quietly permissive.
 */
export function applied(result: unknown): boolean {
	const rows = returningRows(result);
	if (rows === null) {
		throw new TypeError(
			'applied() needs the rows from a RETURNING clause. Add RETURNING to the statement rather than reading a driver rowcount.',
		);
	}
	return rows.length > 0;
}

/** How many rows a statement touched, counted from its RETURNING rows. See applied(). */
export function affected(result: unknown): number {
	const rows = returningRows(result);
	if (rows === null) {
		throw new TypeError(
			'affected() needs the rows from a RETURNING clause. Add RETURNING to the statement rather than reading a driver rowcount.',
		);
	}
	return rows.length;
}

export * from './schema/index.js';
/**
 * The schema as a namespace, for callers that need to hand it to `drizzle()` themselves —
 * the test substrate builds its own PGlite client. Exported deliberately rather than having
 * tests do `import * as schema from '@coolbeans/db'`, which would sweep the helpers in here
 * into the schema type and stop it matching the one production uses.
 */
export * as schema from './schema/index.js';
