// ABOUTME: Usage metering (PRD §12) — atomic quota enforcement and lazy period resets.
// ABOUTME: The increment is a single guarded UPDATE so two concurrent calls can never both pass.

import type { Metric, UsageCounter } from '@coolbeans/db';
import { metrics, usageCounters } from '@coolbeans/db';
import { and, eq, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { licenseDisabled, notFound } from '../http/errors.js';
import { resolveLicense } from './licensing.js';

export interface UsageState {
	current: number;
	limit: number | null;
	resetsAt: string | null;
}

/** Increment outcome: §9 requires the 429 body to carry the same counter fields as success. */
export type IncrementResult =
	| { exceeded: false; state: UsageState }
	| { exceeded: true; state: UsageState };

function nextReset(from: Date, period: 'daily' | 'monthly'): Date {
	if (period === 'daily') {
		const d = new Date(from);
		d.setUTCDate(d.getUTCDate() + 1);
		return d;
	}
	// Monthly, with the day clamped so Jan 31 + 1 month lands on Feb 28/29, not Mar 2/3.
	const year = from.getUTCFullYear();
	const month = from.getUTCMonth() + 1;
	const daysInTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	return new Date(
		Date.UTC(
			year,
			month,
			Math.min(from.getUTCDate(), daysInTarget),
			from.getUTCHours(),
			from.getUTCMinutes(),
			from.getUTCSeconds(),
		),
	);
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

/**
 * Increment a metric atomically, enforcing its quota. Over-limit returns exceeded:true
 * with the unchanged counter state — §9 requires the 429 body to carry current/limit/resets_at.
 */
export function incrementUsage(
	deps: AppDeps,
	keyInput: string,
	metricKey: string,
	delta: number,
): IncrementResult {
	const resolved = resolveLicense(deps, keyInput);
	// Fail closed: a disabled (or lazily-expired trial) license cannot consume quota.
	if (resolved.status === 'disabled') throw licenseDisabled();
	const metric = getMetric(deps, resolved.product.id, metricKey);

	return deps.db.transaction((): IncrementResult => {
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
				exceeded: false,
				state: {
					current: row?.current ?? counter.current + delta,
					limit: null,
					resetsAt: counter.resetsAt,
				},
			};
		}

		// Single guarded UPDATE: applies only if it stays within the limit (atomic on the row).
		const row = deps.db
			.update(usageCounters)
			.set({ current: sql`current + ${delta}` })
			.where(and(eq(usageCounters.id, counter.id), sql`current + ${delta} <= ${limit}`))
			.returning({ current: usageCounters.current })
			.get();
		if (!row) {
			return {
				exceeded: true,
				state: { current: counter.current, limit, resetsAt: counter.resetsAt },
			};
		}
		return { exceeded: false, state: { current: row.current, limit, resetsAt: counter.resetsAt } };
	});
}

export interface UsageCounterView {
	metric: string;
	current: number;
	limit: number | null;
	resetsAt: string | null;
}

/** Current counters for a key (PRD §9 GET /v1/usage). Overdue resets apply on read too. */
export function getUsage(deps: AppDeps, keyInput: string): UsageCounterView[] {
	const resolved = resolveLicense(deps, keyInput);
	const rows = deps.db
		.select({ counter: usageCounters, metric: metrics })
		.from(usageCounters)
		.innerJoin(metrics, eq(metrics.id, usageCounters.metricId))
		.where(eq(usageCounters.licenseId, resolved.license.id))
		.all();
	return rows.map((r) => {
		const counter = applyResetIfDue(deps, r.counter, r.metric);
		return {
			metric: r.metric.key,
			current: counter.current,
			limit: counter.limitOverride ?? r.metric.defaultLimit ?? null,
			resetsAt: counter.resetsAt,
		};
	});
}
