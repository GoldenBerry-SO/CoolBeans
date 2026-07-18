// ABOUTME: Usage metering (PRD §12) — atomic quota enforcement and lazy period resets.
// ABOUTME: The increment is a single guarded UPDATE so two concurrent calls can never both pass.

import type { Metric, UsageCounter } from '@coolbeans/db';
import { metrics, usageCounters } from '@coolbeans/db';
import { and, eq, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { licenseDisabled, notFound, quotaExceeded } from '../http/errors.js';
import { resolveLicense } from './licensing.js';

export interface UsageState {
	current: number;
	limit: number | null;
	resetsAt: string | null;
}

function nextReset(from: Date, period: 'daily' | 'monthly'): Date {
	const d = new Date(from);
	if (period === 'daily') d.setUTCDate(d.getUTCDate() + 1);
	else d.setUTCMonth(d.getUTCMonth() + 1);
	return d;
}

function getMetric(deps: AppDeps, productId: number, key: string): Metric {
	const metric = deps.db
		.select()
		.from(metrics)
		.where(and(eq(metrics.productId, productId), eq(metrics.key, key)))
		.get();
	if (!metric) throw notFound(`No metric "${key}" is defined for this product.`);
	return metric;
}

function getOrCreateCounter(deps: AppDeps, licenseId: number, metric: Metric): UsageCounter {
	const existing = deps.db
		.select()
		.from(usageCounters)
		.where(and(eq(usageCounters.licenseId, licenseId), eq(usageCounters.metricId, metric.id)))
		.get();
	if (existing) return existing;
	const now = nowDate(deps);
	const resetsAt = metric.resetPeriod ? nextReset(now, metric.resetPeriod).toISOString() : null;
	return deps.db
		.insert(usageCounters)
		.values({
			licenseId,
			metricId: metric.id,
			current: 0,
			periodStart: now.toISOString(),
			resetsAt,
		})
		.returning()
		.get();
}

/** Reset the counter to zero and advance the period if the reset time has passed. */
function applyResetIfDue(deps: AppDeps, counter: UsageCounter, metric: Metric): UsageCounter {
	if (!metric.resetPeriod || !counter.resetsAt) return counter;
	const now = nowDate(deps);
	if (now.getTime() < new Date(counter.resetsAt).getTime()) return counter;
	const resetsAt = nextReset(now, metric.resetPeriod).toISOString();
	deps.db
		.update(usageCounters)
		.set({ current: 0, periodStart: now.toISOString(), resetsAt })
		.where(eq(usageCounters.id, counter.id))
		.run();
	return { ...counter, current: 0, periodStart: now.toISOString(), resetsAt };
}

/** Increment a metric atomically, enforcing its quota. Throws 429 quota_exceeded when over. */
export function incrementUsage(
	deps: AppDeps,
	keyInput: string,
	metricKey: string,
	delta: number,
): UsageState {
	const resolved = resolveLicense(deps, keyInput);
	// Fail closed: a disabled (or lazily-expired trial) license cannot consume quota.
	if (resolved.status === 'disabled') throw licenseDisabled();
	const metric = getMetric(deps, resolved.product.id, metricKey);

	return deps.db.transaction((): UsageState => {
		let counter = getOrCreateCounter(deps, resolved.license.id, metric);
		counter = applyResetIfDue(deps, counter, metric);
		const limit = counter.limitOverride ?? metric.defaultLimit ?? null;

		if (limit === null) {
			const row = deps.db
				.update(usageCounters)
				.set({ current: sql`current + ${delta}` })
				.where(eq(usageCounters.id, counter.id))
				.returning({ current: usageCounters.current })
				.get();
			return {
				current: row?.current ?? counter.current + delta,
				limit: null,
				resetsAt: counter.resetsAt,
			};
		}

		// Single guarded UPDATE: applies only if it stays within the limit (atomic on the row).
		const row = deps.db
			.update(usageCounters)
			.set({ current: sql`current + ${delta}` })
			.where(and(eq(usageCounters.id, counter.id), sql`current + ${delta} <= ${limit}`))
			.returning({ current: usageCounters.current })
			.get();
		if (!row) throw quotaExceeded();
		return { current: row.current, limit, resetsAt: counter.resetsAt };
	});
}

export interface UsageCounterView {
	metric: string;
	current: number;
	limit: number | null;
	resetsAt: string | null;
}

/** Current counters for a key (PRD §9 GET /v1/usage). */
export function getUsage(deps: AppDeps, keyInput: string): UsageCounterView[] {
	const resolved = resolveLicense(deps, keyInput);
	const rows = deps.db
		.select({
			key: metrics.key,
			current: usageCounters.current,
			limitOverride: usageCounters.limitOverride,
			defaultLimit: metrics.defaultLimit,
			resetsAt: usageCounters.resetsAt,
		})
		.from(usageCounters)
		.innerJoin(metrics, eq(metrics.id, usageCounters.metricId))
		.where(eq(usageCounters.licenseId, resolved.license.id))
		.all();
	return rows.map((r) => ({
		metric: r.key,
		current: r.current,
		limit: r.limitOverride ?? r.defaultLimit ?? null,
		resetsAt: r.resetsAt,
	}));
}
