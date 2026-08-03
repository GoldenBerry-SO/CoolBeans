// ABOUTME: Per-product per-day validation counts (issue #37) — the Overview chart's source.
// ABOUTME: An aggregate, not a log: validate is the hot path and must not grow a row per check.

import { integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { products } from './products.js';

export const validationCounters = pgTable(
	'validation_counters',
	{
		productId: integer('product_id')
			.notNull()
			.references(() => products.id),
		/** UTC calendar day, YYYY-MM-DD. */
		day: text('day').notNull(),
		count: integer('count').notNull().default(0),
		/**
		 * How many of `count` answered valid:false — a disabled key still being tried, an
		 * unknown seat. Split out (issue #101) because lapsed keys phoning home is exactly
		 * the story an operator wants the chart to tell.
		 */
		refused: integer('refused').notNull().default(0),
	},
	(t) => [primaryKey({ columns: [t.productId, t.day] })],
);

export type ValidationCounter = typeof validationCounters.$inferSelect;
