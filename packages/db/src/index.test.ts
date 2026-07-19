// ABOUTME: Tests the storage adapter — migrations apply on a fresh in-memory DB and a product round-trips.
// ABOUTME: Proves boot → migrate → insert/read for the §17 core, and that a re-migrate is a no-op.

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, migrate, openSqlite, products } from './index.js';

function freshDb() {
	const db = createDb(openSqlite(':memory:'));
	migrate(db);
	return db;
}

describe('storage adapter', () => {
	it('creates all schema tables on a fresh DB', () => {
		const db = freshDb();
		const rows = db.$client
			.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all() as { name: string }[];
		const names = rows.map((r) => r.name);
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
			'provider_events',
			'audit_log',
			'outbox',
		]) {
			expect(names).toContain(t);
		}
	});

	it('round-trips a product', () => {
		const db = freshDb();
		db.insert(products)
			.values({ slug: 'clementine', name: 'Clementine', keyPrefix: 'CLEM', emailFrom: 'r@c.io' })
			.run();
		const row = db.select().from(products).where(eq(products.slug, 'clementine')).get();
		expect(row?.keyPrefix).toBe('CLEM');
		expect(row?.activationLimit).toBe(3);
		expect(row?.activationModel).toBe('node_locked');
	});

	it('enforces the unique key_prefix constraint', () => {
		const db = freshDb();
		const insert = (slug: string) =>
			db
				.insert(products)
				.values({ slug, name: slug, keyPrefix: 'CLEM', emailFrom: 'r@c.io' })
				.run();
		insert('a');
		expect(() => insert('b')).toThrow();
	});

	it('re-migrating an up-to-date DB is a no-op', () => {
		const db = freshDb();
		expect(() => migrate(db)).not.toThrow();
	});
});
