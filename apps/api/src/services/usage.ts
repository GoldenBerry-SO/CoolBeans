// ABOUTME: Usage metering (PRD §12) — atomic quota enforcement and lazy period resets.
// ABOUTME: The increment is a single guarded UPDATE so two concurrent calls can never both pass.

import type { Metric, UsageCounter } from '@coolbeans/db';
import { activations, metrics, usageCounters } from '@coolbeans/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate, withTx } from '../deps.js';
import { licenseDisabled, notFound, unknownInstance } from '../http/errors.js';
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

async function getMetric(deps: AppDeps, productId: number, key: string): Promise<Metric> {
	const [metric] = await deps.db
		.select()
		.from(metrics)
		.where(and(eq(metrics.productId, productId), eq(metrics.key, key)))
		.limit(1);
	if (!metric) throw notFound(`No metric "${key}" is defined for this product.`);
	return metric;
}

async function getOrCreateCounter(
	deps: AppDeps,
	licenseId: number,
	metric: Metric,
): Promise<UsageCounter> {
	const [existing] = await deps.db
		.select()
		.from(usageCounters)
		.where(and(eq(usageCounters.licenseId, licenseId), eq(usageCounters.metricId, metric.id)))
		.limit(1);
	if (existing) return existing;
	const now = nowDate(deps);
	const resetsAt = metric.resetPeriod ? nextReset(now, metric.resetPeriod).toISOString() : null;
	// Upsert, not insert. Two first-ever increments for the same (licence, metric) race
	// this create; on Postgres the loser's unique violation aborts the WHOLE enclosing
	// transaction, so the increment that should have counted 500s instead. The no-op
	// DO UPDATE (rather than DO NOTHING) is what makes RETURNING yield the winner's row
	// to the loser, so both callers proceed against the same counter.
	const [created] = await deps.db
		.insert(usageCounters)
		.values({
			licenseId,
			metricId: metric.id,
			current: 0,
			periodStart: now.toISOString(),
			resetsAt,
		})
		.onConflictDoUpdate({
			target: [usageCounters.licenseId, usageCounters.metricId],
			set: { licenseId: sql`excluded.license_id` },
		})
		.returning();
	return created;
}

/** Reset the counter to zero and advance the period if the reset time has passed. */
async function applyResetIfDue(
	deps: AppDeps,
	counter: UsageCounter,
	metric: Metric,
): Promise<UsageCounter> {
	if (!metric.resetPeriod || !counter.resetsAt) return counter;
	const now = nowDate(deps);
	if (now.getTime() < new Date(counter.resetsAt).getTime()) return counter;
	const resetsAt = nextReset(now, metric.resetPeriod).toISOString();
	await deps.db
		.update(usageCounters)
		.set({ current: 0, periodStart: now.toISOString(), resetsAt })
		.where(eq(usageCounters.id, counter.id));
	return { ...counter, current: 0, periodStart: now.toISOString(), resetsAt };
}

/**
 * Increment a metric atomically, enforcing its quota. Over-limit returns exceeded:true
 * with the unchanged counter state — §9 requires the 429 body to carry current/limit/resets_at.
 */
export async function incrementUsage(
	deps: AppDeps,
	keyInput: string,
	instanceId: string,
	metricKey: string,
	delta: number,
): Promise<IncrementResult> {
	const resolved = await resolveLicense(deps, keyInput);
	// Fail closed: a disabled (or lazily-expired trial) license cannot consume quota.
	if (resolved.status === 'disabled') throw licenseDisabled();
	// §9 sends instance_id with every increment: metering belongs to a live seat, so a
	// device that was deactivated (its seat handed back) stops counting. A lapsed
	// floating lease is deliberately NOT rejected here — the seat frees itself and the
	// client has not been told, so failing its metering mid-run would be a surprise.
	const [seat] = await deps.db
		.select({ id: activations.id })
		.from(activations)
		.where(
			and(
				eq(activations.instanceId, instanceId),
				eq(activations.licenseId, resolved.license.id),
				isNull(activations.deactivatedAt),
			),
		)
		.limit(1);
	if (!seat) throw unknownInstance();
	const metric = await getMetric(deps, resolved.product.id, metricKey);

	return await deps.db.transaction(async (tx): Promise<IncrementResult> => {
		const scoped = withTx(deps, tx);
		let counter = await getOrCreateCounter(scoped, resolved.license.id, metric);
		counter = await applyResetIfDue(scoped, counter, metric);
		const limit = counter.limitOverride ?? metric.defaultLimit ?? null;

		if (limit === null) {
			const [row] = await scoped.db
				.update(usageCounters)
				.set({ current: sql`current + ${delta}` })
				.where(eq(usageCounters.id, counter.id))
				.returning({ current: usageCounters.current });
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
		const [row] = await scoped.db
			.update(usageCounters)
			.set({ current: sql`current + ${delta}` })
			.where(and(eq(usageCounters.id, counter.id), sql`current + ${delta} <= ${limit}`))
			.returning({ current: usageCounters.current });
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
export async function getUsage(deps: AppDeps, keyInput: string): Promise<UsageCounterView[]> {
	const resolved = await resolveLicense(deps, keyInput);
	const rows = await deps.db
		.select({ counter: usageCounters, metric: metrics })
		.from(usageCounters)
		.innerJoin(metrics, eq(metrics.id, usageCounters.metricId))
		.where(eq(usageCounters.licenseId, resolved.license.id));
	const views: UsageCounterView[] = [];
	for (const r of rows) {
		const counter = await applyResetIfDue(deps, r.counter, r.metric);
		views.push({
			metric: r.metric.key,
			current: counter.current,
			limit: counter.limitOverride ?? r.metric.defaultLimit ?? null,
			resetsAt: counter.resetsAt,
		});
	}
	return views;
}
