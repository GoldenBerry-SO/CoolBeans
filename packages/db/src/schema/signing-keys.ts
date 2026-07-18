// ABOUTME: The signing_keys table — per-product (or global) Ed25519 keypairs for offline tokens (PRD §11).
// ABOUTME: private_key is encrypted at rest; rotation keeps multiple active public keys verifiable.

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { products } from './products.js';

export const signingKeys = sqliteTable('signing_keys', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	productId: integer('product_id').references(() => products.id),
	algorithm: text('algorithm').notNull().default('ed25519'),
	publicKey: text('public_key').notNull(),
	privateKey: text('private_key').notNull(),
	active: integer('active', { mode: 'boolean' }).notNull().default(true),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type SigningKey = typeof signingKeys.$inferSelect;
export type NewSigningKey = typeof signingKeys.$inferInsert;
