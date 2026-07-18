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

await check('the SQLite seat statement OVER-ALLOCATES on Postgres (why the port needs care)', async () => {
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
});

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
await check('the floating-lease guard needs the same licence lock', async () => {
	await resetSeats();
	// Seed the cap's worth of live leases, then have extras try to renew into the pool.
	for (let i = 0; i < LIMIT; i += 1) {
		await sql`INSERT INTO activations (instance_id, license_id) VALUES (${`live_${i}`}, 1)`;
	}
	const extras = [];
	for (let i = 0; i < 5; i += 1) {
		const [row] = await sql`
			INSERT INTO activations (instance_id, license_id, deactivated_at)
			VALUES (${`expired_${i}`}, 1, 'expired') RETURNING id`;
		extras.push(row.id);
	}

	await Promise.all(
		extras.map((id) =>
			sql
				.begin(async (tx) => {
					await tx`SELECT id FROM licenses WHERE id = 1 FOR UPDATE`;
					return tx`
						UPDATE activations SET deactivated_at = NULL
						WHERE id = ${id}
						AND (SELECT COUNT(*) FROM activations
						     WHERE license_id = 1 AND id != ${id} AND deactivated_at IS NULL) < ${LIMIT}`;
				})
				.catch(() => null),
		),
	);
	const [{ count }] = await sql`
		SELECT COUNT(*)::int AS count FROM activations
		WHERE license_id = 1 AND deactivated_at IS NULL`;
	assert.equal(count, LIMIT, `live leases ${count}, expected ${LIMIT}`);
});

console.log(`\n${checks} atomicity checks passed against Postgres.\n`);
await sql.end();
