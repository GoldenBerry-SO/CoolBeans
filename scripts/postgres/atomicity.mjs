// ABOUTME: Proves which of our atomic statements survive Postgres (issue #32) and which do not.
// ABOUTME: Run against a real Postgres: the whole point is contention a mock cannot produce.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../../packages/db/package.json'));
const postgres = require('postgres');

const URL_ = process.env.PG_URL ?? 'postgres://postgres:beans@localhost:55432/coolbeans';
const sql = postgres(URL_, { max: 20, onnotice: () => {} });

let checks = 0;
const check = async (label, fn) => {
	await fn();
	checks += 1;
	console.log(`  ✓ ${label}`);
};

console.log('\nAtomicity on Postgres — the statements §12 says must never read-then-write');

// ---------------------------------------------------------------------------
// Seat cap. SQLite serialises writers, so INSERT…SELECT…WHERE (count) < limit is
// safe there. Postgres runs the subquery against a snapshot, so every concurrent
// contender reads the same count and they all insert.
// ---------------------------------------------------------------------------
async function resetSeats() {
	await sql`DROP TABLE IF EXISTS activations`;
	await sql`DROP TABLE IF EXISTS licenses`;
	await sql`CREATE TABLE licenses (id integer PRIMARY KEY)`;
	await sql`INSERT INTO licenses (id) VALUES (1)`;
	await sql`CREATE TABLE activations (
		id serial PRIMARY KEY, instance_id text NOT NULL,
		license_id integer NOT NULL, deactivated_at text)`;
}

const LIMIT = 3;
const CONTENDERS = 12;

await check(
	'the SQLite seat statement OVER-ALLOCATES on Postgres (why the port needs care)',
	async () => {
		await resetSeats();
		await Promise.all(
			Array.from({ length: CONTENDERS }, (_, i) =>
				sql`
				INSERT INTO activations (instance_id, license_id)
				SELECT ${`inst_${i}`}, 1
				WHERE (SELECT COUNT(*) FROM activations
				       WHERE license_id = 1 AND deactivated_at IS NULL) < ${LIMIT}
				RETURNING id`.catch(() => null),
			),
		);
		const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM activations`;
		assert.ok(
			count > LIMIT,
			`expected the naive form to over-allocate so this test stays honest, got ${count}`,
		);
	},
);

await check('locking the licence row first holds the cap exactly', async () => {
	await resetSeats();
	const results = await Promise.all(
		Array.from({ length: CONTENDERS }, (_, i) =>
			sql
				.begin(async (tx) => {
					// Every contender for THIS licence queues behind its row lock, so each
					// one counts what the previous winner already inserted. Contention is
					// per licence, which is the granularity we want.
					await tx`SELECT id FROM licenses WHERE id = 1 FOR UPDATE`;
					const [row] = await tx`
						INSERT INTO activations (instance_id, license_id)
						SELECT ${`inst_${i}`}, 1
						WHERE (SELECT COUNT(*) FROM activations
						       WHERE license_id = 1 AND deactivated_at IS NULL) < ${LIMIT}
						RETURNING id`;
					return Boolean(row);
				})
				.catch(() => false),
		),
	);
	const granted = results.filter(Boolean).length;
	const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM activations`;
	assert.equal(granted, LIMIT, `granted ${granted}, expected ${LIMIT}`);
	assert.equal(count, LIMIT, `stored ${count}, expected ${LIMIT}`);
});

// ---------------------------------------------------------------------------
// Usage quota. One UPDATE against one row: Postgres takes the row lock itself and
// re-evaluates the WHERE against the updated row, so this one ports unchanged.
// ---------------------------------------------------------------------------
const QUOTA = 10;

await check('the usage quota statement holds on Postgres unchanged', async () => {
	await sql`DROP TABLE IF EXISTS usage_counters`;
	await sql`CREATE TABLE usage_counters (id serial PRIMARY KEY, current integer NOT NULL DEFAULT 0)`;
	await sql`INSERT INTO usage_counters (current) VALUES (0)`;

	const results = await Promise.all(
		Array.from({ length: 40 }, () =>
			sql`
				UPDATE usage_counters SET current = current + 1
				WHERE id = 1 AND current + 1 <= ${QUOTA}
				RETURNING current`
				.then((rows) => rows.length > 0)
				.catch(() => false),
		),
	);
	const accepted = results.filter(Boolean).length;
	const [{ current }] = await sql`SELECT current FROM usage_counters WHERE id = 1`;
	assert.equal(accepted, QUOTA);
	assert.equal(current, QUOTA, 'the counter must never exceed its limit');
});

// ---------------------------------------------------------------------------
// Floating lease renewal. Same shape as the seat insert — a guarded UPDATE whose
// guard is a COUNT subquery — so it has the same snapshot problem.
// ---------------------------------------------------------------------------
/**
 * Seed the licence one seat short of its cap, then have several expired leases race to
 * renew into that single free slot. Filling the pool first would prove nothing: the guard
 * rejects everyone when there is no room, lock or no lock.
 */
async function seedLeaseContention() {
	await resetSeats();
	for (let i = 0; i < LIMIT - 1; i += 1) {
		await sql`INSERT INTO activations (instance_id, license_id) VALUES (${`live_${i}`}, 1)`;
	}
	const extras = [];
	for (let i = 0; i < 5; i += 1) {
		const [row] = await sql`
			INSERT INTO activations (instance_id, license_id, deactivated_at)
			VALUES (${`expired_${i}`}, 1, 'expired') RETURNING id`;
		extras.push(row.id);
	}
	return extras;
}

const liveLeases = async () => {
	const [{ count }] = await sql`
		SELECT COUNT(*)::int AS count FROM activations
		WHERE license_id = 1 AND deactivated_at IS NULL`;
	return count;
};

const renewGuard = (tx, id) => tx`
	UPDATE activations SET deactivated_at = NULL
	WHERE id = ${id}
	AND (SELECT COUNT(*) FROM activations
	     WHERE license_id = 1 AND id != ${id} AND deactivated_at IS NULL) < ${LIMIT}`;

await check(
	'the unlocked lease renewal OVER-ALLOCATES, so this test can actually fail',
	async () => {
		const extras = await seedLeaseContention();
		await Promise.all(extras.map((id) => renewGuard(sql, id).catch(() => null)));
		const count = await liveLeases();
		assert.ok(count > LIMIT, `expected the unlocked form to over-allocate, got ${count}`);
	},
);

await check('the floating-lease guard holds the cap with the same licence lock', async () => {
	const extras = await seedLeaseContention();
	await Promise.all(
		extras.map((id) =>
			sql
				.begin(async (tx) => {
					await tx`SELECT id FROM licenses WHERE id = 1 FOR UPDATE`;
					return renewGuard(tx, id);
				})
				.catch(() => null),
		),
	);
	assert.equal(await liveLeases(), LIMIT, 'exactly one contender may take the free slot');
});

// ---------------------------------------------------------------------------
// Product cap (hosted Free plan). Same INSERT…SELECT…WHERE (count) < limit shape as
// the seat cap, so it inherits the same Postgres caveat. This is the check the
// vitest suite cannot do: better-sqlite3 is synchronous, so a read-then-write
// version of the handler passes there too.
// ---------------------------------------------------------------------------
const PRODUCT_LIMIT = 1;
const CREATORS = 8;

async function resetProducts() {
	await sql`DROP TABLE IF EXISTS products`;
	await sql`CREATE TABLE products (
		id serial PRIMARY KEY, account_id integer NOT NULL,
		slug text NOT NULL UNIQUE, archived_at text)`;
}

const liveProducts = async () => {
	const [row] = await sql`
		SELECT COUNT(*)::int AS n FROM products WHERE account_id = 1 AND archived_at IS NULL`;
	return row.n;
};

const createGuard = (tx, slug) => tx`
	INSERT INTO products (account_id, slug)
	SELECT 1, ${slug}
	WHERE (SELECT COUNT(*) FROM products WHERE account_id = 1 AND archived_at IS NULL)
	      < ${PRODUCT_LIMIT}`;

await check(
	'the read-then-write product cap OVER-ALLOCATES, so this test can actually fail',
	async () => {
		await resetProducts();
		await Promise.all(
			Array.from({ length: CREATORS }, (_, i) =>
				sql
					.begin(async (tx) => {
						const [{ n }] = await tx`
							SELECT COUNT(*)::int AS n FROM products
							WHERE account_id = 1 AND archived_at IS NULL`;
						if (n >= PRODUCT_LIMIT) return null;
						return tx`INSERT INTO products (account_id, slug) VALUES (1, ${`p${i}`})`;
					})
					.catch(() => null),
			),
		);
		const count = await liveProducts();
		assert.ok(count > PRODUCT_LIMIT, `expected read-then-write to over-allocate, got ${count}`);
	},
);

await check('the product cap holds with the account row locked first', async () => {
	await resetProducts();
	await sql`DROP TABLE IF EXISTS accounts`;
	await sql`CREATE TABLE accounts (id integer PRIMARY KEY)`;
	await sql`INSERT INTO accounts (id) VALUES (1)`;
	await Promise.all(
		Array.from({ length: CREATORS }, (_, i) =>
			sql
				.begin(async (tx) => {
					// Same remedy the seat cap needs on Postgres: serialise the contenders on
					// the row the cap is counted against, then run the guarded insert.
					await tx`SELECT id FROM accounts WHERE id = 1 FOR UPDATE`;
					return createGuard(tx, `p${i}`);
				})
				.catch(() => null),
		),
	);
	assert.equal(await liveProducts(), PRODUCT_LIMIT, 'exactly one creator may take the free slot');
});

console.log(`\n${checks} atomicity checks passed against Postgres.\n`);
await sql.end();
