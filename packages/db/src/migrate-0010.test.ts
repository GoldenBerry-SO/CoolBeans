// ABOUTME: Proves the tenancy migration backfills a database that already holds live rows.
// ABOUTME: Applies 0000-0009 only, writes real data, then migrates and checks every row landed on account 1.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, migrate, openSqlite } from './index.js';

const realFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const temps: string[] = [];

afterEach(() => {
	for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A copy of the migrations folder truncated to everything before `stopBefore`. The
 * migrator drives entirely off the journal, so dropping the later entries is what makes
 * it stop early — the .sql files can stay.
 */
function migrationsUpTo(stopBefore: number): string {
	const dir = mkdtempSync(join(tmpdir(), 'coolbeans-migrate-'));
	temps.push(dir);
	cpSync(realFolder, dir, { recursive: true });
	const journalPath = join(dir, 'meta', '_journal.json');
	const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
		entries: { idx: number }[];
	};
	journal.entries = journal.entries.filter((e) => e.idx < stopBefore);
	writeFileSync(journalPath, JSON.stringify(journal, null, 2));
	return dir;
}

/** A database at schema 0009 with a product, an admin, a licence and an audit row in it. */
function dbWithLiveDataAt0009() {
	const db = createDb(openSqlite(':memory:'));
	migrateSqlite(db, { migrationsFolder: migrationsUpTo(10) });
	const raw = db.$client;
	raw
		.prepare(
			"INSERT INTO products (slug, name, key_prefix, email_from) VALUES ('clementine','Clementine','CLEM','r@c.io')",
		)
		.run();
	raw.prepare("INSERT INTO admin_users (email) VALUES ('chris@example.com')").run();
	raw
		.prepare(
			"INSERT INTO admin_sessions (token_hash, admin_user_id, expires_at) VALUES ('hash','1','2099-01-01')",
		)
		.run();
	raw
		.prepare(
			"INSERT INTO purchases (product_id, provider, email) VALUES (1,'stripe','buyer@example.com')",
		)
		.run();
	raw
		.prepare(
			"INSERT INTO licenses (product_id, purchase_id, key, status, tier) VALUES (1,1,'CLEM1234','active','lifetime')",
		)
		.run();
	raw.prepare("INSERT INTO audit_log (action, actor) VALUES ('admin.signed_in','admin:1')").run();
	raw
		.prepare(
			"INSERT INTO provider_events (id, provider, type) VALUES ('evt_1','stripe','checkout.session.completed')",
		)
		.run();
	return db;
}

describe('0010 tenancy migration', () => {
	it('creates account 1 and grandfathers it to pro', () => {
		const db = dbWithLiveDataAt0009();
		migrate(db);
		const account = db.$client.prepare('SELECT * FROM accounts WHERE id = 1').get() as
			| { id: number; plan: string; name: string }
			| undefined;
		expect(account).toBeDefined();
		// An existing instance must not wake up capped at one product.
		expect(account?.plan).toBe('pro');
	});

	it('backfills every pre-tenancy row onto account 1', () => {
		const db = dbWithLiveDataAt0009();
		migrate(db);
		const raw = db.$client;
		for (const table of ['products', 'admin_users', 'admin_sessions', 'audit_log']) {
			const row = raw.prepare(`SELECT account_id FROM ${table} WHERE rowid = 1`).get() as {
				account_id: number | null;
			};
			expect(row.account_id, `${table} was not backfilled`).toBe(1);
		}
	});

	it('leaves provider_events.account_id nullable for events that never resolve a product', () => {
		const db = dbWithLiveDataAt0009();
		migrate(db);
		const row = db.$client
			.prepare("SELECT account_id FROM provider_events WHERE id = 'evt_1'")
			.get() as { account_id: number | null };
		expect(row.account_id).toBeNull();
	});

	it('applies cleanly to a fresh database and still yields account 1', () => {
		const db = createDb(openSqlite(':memory:'));
		migrate(db);
		const account = db.$client.prepare('SELECT id FROM accounts WHERE id = 1').get();
		expect(account).toBeDefined();
	});
});
