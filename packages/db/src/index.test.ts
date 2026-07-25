// ABOUTME: Tests the storage adapter — migrations apply on a fresh DB and a product round-trips.
// ABOUTME: Also pins the things a dialect port silently gets wrong: seeds, sequences, FKs, dates.

import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { accounts, products } from './index.js';
import * as schema from './schema/index.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * A migrated database. Built once: the migration is the thing under test here, and every
 * assertion below reads rather than writes conflicting state.
 */
async function freshDb() {
	const client = new PGlite();
	const db = drizzle(client, { schema });
	await migratePglite(db, { migrationsFolder });
	return { db, client };
}

let db: Awaited<ReturnType<typeof freshDb>>['db'];
let client: PGlite;

beforeAll(async () => {
	({ db, client } = await freshDb());
});

/**
 * The Postgres error code behind a rejected query.
 *
 * Drizzle wraps driver errors in its own message ("Failed query: ..."), so matching on the
 * text finds nothing useful. The SQLSTATE on the cause is the precise thing worth asserting:
 * 23503 is foreign_key_violation and nothing else produces it.
 */
async function errorCodeOf(run: () => Promise<unknown>): Promise<string | undefined> {
	try {
		await run();
	} catch (err) {
		const cause = (err as { cause?: { code?: string } }).cause;
		return cause?.code ?? (err as { code?: string }).code;
	}
	return undefined;
}

const FOREIGN_KEY_VIOLATION = '23503';
/**
 * ON DELETE RESTRICT raises this, where the default NO ACTION would raise 23503. Asserting
 * the difference is what proves the delete rule is actually RESTRICT and not merely a
 * foreign key that happens to reject at commit time.
 */
const RESTRICT_VIOLATION = '23001';

async function tableNames(): Promise<string[]> {
	const res = await client.query<{ table_name: string }>(
		`SELECT table_name FROM information_schema.tables
		 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
		 ORDER BY table_name`,
	);
	return res.rows.map((r) => r.table_name);
}

describe('storage adapter', () => {
	it('creates all schema tables on a fresh DB', async () => {
		const names = await tableNames();
		for (const t of [
			'accounts',
			'account_subscriptions',
			'products',
			'purchases',
			'licenses',
			'activations',
			'metrics',
			'usage_counters',
			'signing_keys',
			'audit_log',
			'provider_events',
			'outbox',
			'admin_users',
			'admin_sessions',
			'auth_codes',
			'license_revocations',
			'pending_revocations',
			'validation_counters',
		]) {
			expect(names).toContain(t);
		}
	});

	it('seeds the default account', async () => {
		// Account 1 is what lets a self-host work with no signup ceremony, and what every
		// admin test assumes. If the seed is ever dropped from the migration, the whole
		// admin surface 404s on a fresh database and the cause is a long way from the symptom.
		const [account] = await db.select().from(accounts).where(eq(accounts.id, 1));
		expect(account).toBeDefined();
		expect(account?.plan).toBe('pro');
	});

	it('advances the account sequence past the seeded row', async () => {
		// serial does not observe an explicitly-inserted id. Without the setval in the
		// migration the first real signup collides with the seed on the primary key —
		// which would only ever be discovered by the first person to sign up.
		const [created] = await db.insert(accounts).values({ name: 'Second' }).returning();
		expect(created?.id).toBeGreaterThan(1);
	});

	it('round-trips a product', async () => {
		const [inserted] = await db
			.insert(products)
			.values({
				accountId: 1,
				slug: 'clementine',
				name: 'Clementine',
				keyPrefix: 'CLEM',
				emailFrom: 'r@c.io',
			})
			.returning();
		expect(inserted?.slug).toBe('clementine');
		const [read] = await db.select().from(products).where(eq(products.slug, 'clementine'));
		expect(read?.keyPrefix).toBe('CLEM');
	});

	it('defaults timestamps in the exact format the code compares against', async () => {
		// Every date here is text, compared with < and > against toISOString(). `now()::text`
		// would yield "2026-07-20 12:00:00.123456" — space instead of T, no Z — and since
		// ' ' < 'T', every defaulted row would sort before every app-written one forever.
		// On provider_events.received_at that alone would make the retention prune delete
		// every finished event immediately.
		const [row] = await db.select().from(products).where(eq(products.slug, 'clementine'));
		expect(row?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect(new Date(row?.createdAt ?? '').toISOString()).toBe(row?.createdAt);
	});

	it('enforces the account foreign keys SQLite could not take', async () => {
		// These columns carried no REFERENCES under SQLite and were covered by a boot-time
		// assertion instead. The database enforces them now; this is the proof they landed.
		const code = await errorCodeOf(() =>
			db.insert(products).values({
				accountId: 9999,
				slug: 'orphan',
				name: 'Orphan',
				keyPrefix: 'ORPH',
				emailFrom: 'r@c.io',
			}),
		);
		expect(code).toBe(FOREIGN_KEY_VIOLATION);
	});

	it('refuses to delete an account that still owns products', async () => {
		// RESTRICT rather than CASCADE is deliberate: deleting a populated tenant should
		// fail loudly, not silently take their licences with it.
		const code = await errorCodeOf(() => db.delete(accounts).where(eq(accounts.id, 1)));
		expect(code).toBe(RESTRICT_VIOLATION);
	});

	it('applies migrations idempotently', async () => {
		const before = await tableNames();
		await migratePglite(db, { migrationsFolder });
		expect(await tableNames()).toEqual(before);
	});
});

describe('applied()/affected()', () => {
	it('reads both driver shapes for RETURNING rows', async () => {
		const { applied, affected } = await import('./index.js');
		// postgres-js hands back an array; PGlite hands back { rows }. Both must read the
		// same, or guarded statements throw on one driver and work on the other.
		expect(applied([{ id: 1 }])).toBe(true);
		expect(applied([])).toBe(false);
		expect(applied({ rows: [{ id: 1 }], fields: [], affectedRows: 1 })).toBe(true);
		expect(applied({ rows: [], fields: [], affectedRows: 0 })).toBe(false);
		expect(affected([{ id: 1 }, { id: 2 }])).toBe(2);
		expect(affected({ rows: [{ id: 1 }], fields: [], affectedRows: 5 })).toBe(1);
	});

	it('refuses a rowcount-shaped result outright', async () => {
		const { applied, affected } = await import('./index.js');
		// { affectedRows } with no rows array is a statement missing its RETURNING clause.
		// Accepting it would let the count-field trap back in through the front door: a
		// guarded UPDATE that matched nothing but "affected" nothing would read as applied
		// or not depending on which field someone reached for.
		expect(() => applied({ affectedRows: 1 })).toThrow(/RETURNING/);
		expect(() => applied({ changes: 1 })).toThrow(/RETURNING/);
		expect(() => applied(undefined)).toThrow(/RETURNING/);
		expect(() => affected({ affectedRows: 3 })).toThrow(/RETURNING/);
	});

	it('counts RETURNING rows, never the affectedRows field', async () => {
		const { affected } = await import('./index.js');
		// If these ever disagree, the rows are the truth: they exist only when the
		// statement's WHERE actually matched.
		expect(affected({ rows: [], affectedRows: 7 })).toBe(0);
	});
});

describe('assertSchemaCurrent', () => {
	it('accepts a database migrated by this build', async () => {
		const { assertSchemaCurrent } = await import('./index.js');
		const fresh = await freshDb();
		await expect(assertSchemaCurrent(fresh.db)).resolves.toBeUndefined();
	});

	it('refuses a database built from a different migration lineage', async () => {
		// The pricing redesign replaced the original migrations rather than adding to them, so
		// a database created before it reports MORE applied migrations than this build ships
		// while lacking license_grants, stripe_connections and licenses.kind. Counting only
		// "behind" would call that current, boot, and then fail on every grant query. It has
		// to refuse instead.
		const { assertSchemaCurrent } = await import('./index.js');
		const fresh = await freshDb();
		await fresh.client.exec(
			`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('older-lineage', 1)`,
		);
		await expect(assertSchemaCurrent(fresh.db)).rejects.toThrow(/different migration lineage/);
	});

	it('still refuses a database that is simply behind', async () => {
		const { assertSchemaCurrent } = await import('./index.js');
		const client = new PGlite();
		const bare = drizzle(client, { schema });
		await expect(assertSchemaCurrent(bare)).rejects.toThrow(/no migrations applied/);
	});
});
