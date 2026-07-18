// ABOUTME: Per-product per-day validation counts (issue #37) — the Overview chart's source.
// ABOUTME: An aggregate, not a log: validate is the hot path and must not grow a row per check.

import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { products } from './products.js';

export const validationCounters = sqliteTable(
	'validation_counters',
	{
		productId: integer('product_id')
			.notNull()
			.references(() => products.id),
		/** UTC calendar day, YYYY-MM-DD. */
		day: text('day').notNull(),
		count: integer('count').notNull().default(0),
	},
	(t) => [primaryKey({ columns: [t.productId, t.day] })],
);

export type ValidationCounter = typeof validationCounters.$inferSelect;
