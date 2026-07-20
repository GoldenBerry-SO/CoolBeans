// ABOUTME: The signing_keys table — per-product (or global) Ed25519 keypairs for offline tokens (PRD §11).
// ABOUTME: private_key is encrypted at rest; rotation keeps multiple active public keys verifiable.

import { boolean, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { isoNow } from './columns.js';
import { products } from './products.js';

export const signingKeys = pgTable('signing_keys', {
	id: serial('id').primaryKey(),
	productId: integer('product_id').references(() => products.id),
	algorithm: text('algorithm').notNull().default('ed25519'),
	publicKey: text('public_key').notNull(),
	privateKey: text('private_key').notNull(),
	active: boolean('active').notNull().default(true),
	createdAt: text('created_at').notNull().default(isoNow),
});

export type SigningKey = typeof signingKeys.$inferSelect;
export type NewSigningKey = typeof signingKeys.$inferInsert;
