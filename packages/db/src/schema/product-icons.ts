// ABOUTME: Product icons (issue #115) — the vendor's logo, shown on licence emails and the console.
// ABOUTME: Its own table, not a products column: the blob must stay off the hot activate/validate reads.

import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { isoNow } from './columns.js';
import { products } from './products.js';

export const productIcons = pgTable('product_icons', {
	// One icon per product, replaced in place; the PK is the product itself.
	productId: integer('product_id')
		.primaryKey()
		.references(() => products.id, { onDelete: 'cascade' }),
	mime: text('mime').notNull(),
	/** Base64 of the image bytes. Capped at upload (256KB decoded), so ~350KB of text. */
	data: text('data').notNull(),
	updatedAt: text('updated_at').notNull().default(isoNow),
});

export type ProductIcon = typeof productIcons.$inferSelect;
