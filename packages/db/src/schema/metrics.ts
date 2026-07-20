// ABOUTME: The metrics and usage_counters tables — per-product metered quotas (PRD §12, §17).
// ABOUTME: usage_counters holds the current value; quota enforcement is a single guarded UPDATE.

import { integer, pgTable, serial, text, unique } from 'drizzle-orm/pg-core';
import { isoNow } from './columns.js';
import { licenses } from './licenses.js';
import { products } from './products.js';

export const metrics = pgTable(
	'metrics',
	{
		id: serial('id').primaryKey(),
		productId: integer('product_id')
			.notNull()
			.references(() => products.id),
		key: text('key').notNull(),
		displayName: text('display_name').notNull(),
		defaultLimit: integer('default_limit'),
		resetPeriod: text('reset_period', { enum: ['daily', 'monthly'] }),
		createdAt: text('created_at').notNull().default(isoNow),
	},
	(t) => [unique('uq_metrics_product_key').on(t.productId, t.key)],
);

export const usageCounters = pgTable(
	'usage_counters',
	{
		id: serial('id').primaryKey(),
		licenseId: integer('license_id')
			.notNull()
			.references(() => licenses.id),
		metricId: integer('metric_id')
			.notNull()
			.references(() => metrics.id),
		current: integer('current').notNull().default(0),
		limitOverride: integer('limit_override'),
		periodStart: text('period_start').notNull().default(isoNow),
		resetsAt: text('resets_at'),
	},
	(t) => [unique('uq_usage_license_metric').on(t.licenseId, t.metricId)],
);

export type Metric = typeof metrics.$inferSelect;
export type NewMetric = typeof metrics.$inferInsert;
export type UsageCounter = typeof usageCounters.$inferSelect;
export type NewUsageCounter = typeof usageCounters.$inferInsert;
