// ABOUTME: Which licences validated on which day (issue #101) — the "daily active customers" set.
// ABOUTME: One row per licence per product-day, upserted DO NOTHING; distinct counts read from here.

import { integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { licenses } from './licenses.js';
import { products } from './products.js';

export const validationSeen = pgTable(
	'validation_seen',
	{
		productId: integer('product_id')
			.notNull()
			.references(() => products.id),
		/** UTC calendar day, YYYY-MM-DD. */
		day: text('day').notNull(),
		licenseId: integer('license_id')
			.notNull()
			.references(() => licenses.id),
	},
	(t) => [primaryKey({ columns: [t.productId, t.day, t.licenseId] })],
);

export type ValidationSeen = typeof validationSeen.$inferSelect;
