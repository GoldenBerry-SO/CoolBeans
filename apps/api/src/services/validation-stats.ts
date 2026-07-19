// ABOUTME: Daily validation counts per product (issue #37) — what the Overview chart draws.
// ABOUTME: One upsert per validate; a counter failure must never fail the validation itself.

import { validationCounters } from '@coolbeans/db';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';

/** UTC calendar day for a moment, YYYY-MM-DD. */
function dayOf(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/**
 * Count one validation. Called on the hot path, so it is a single upsert and its failure
 * is swallowed: a broken counter must never turn a healthy licence check into an error.
 */
export function recordValidation(deps: AppDeps, productId: number): void {
	try {
		deps.db
			.insert(validationCounters)
			.values({ productId, day: dayOf(nowDate(deps)), count: 1 })
			.onConflictDoUpdate({
				target: [validationCounters.productId, validationCounters.day],
				set: { count: sql`${validationCounters.count} + 1` },
			})
			.run();
	} catch (err) {
		deps.logger.error('Validation counter failed', { message: (err as Error).message });
	}
}

export interface ValidationDay {
	day: string;
	count: number;
}

/**
 * The last N days of validation counts, oldest first, with missing days filled as zero so
 * the chart has no gaps.
 *
 * Pass `productId` for one product, or `productIds` to total across a set (an account's
 * products). Passing neither totals across the whole instance, which only the self-host
 * single-account case should be doing.
 */
export function recentValidationCounts(
	deps: AppDeps,
	args: { days: number; productId?: number; productIds?: number[] },
): ValidationDay[] {
	const today = nowDate(deps);
	const window: string[] = [];
	for (let i = args.days - 1; i >= 0; i -= 1) {
		const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
		window.push(dayOf(d));
	}

	const oldest = window[0] ?? dayOf(today);
	// An empty productIds list means the account owns nothing, which is not the same as
	// "no filter" — without this it would fall through and total the whole instance.
	if (args.productIds && args.productIds.length === 0) {
		return window.map((day) => ({ day, count: 0 }));
	}
	const scope =
		args.productId !== undefined
			? eq(validationCounters.productId, args.productId)
			: args.productIds
				? inArray(validationCounters.productId, args.productIds)
				: undefined;
	const rows = deps.db
		.select({ day: validationCounters.day, count: validationCounters.count })
		.from(validationCounters)
		.where(
			scope ? and(gte(validationCounters.day, oldest), scope) : gte(validationCounters.day, oldest),
		)
		.all();

	// Several products can share a day, so total rather than overwrite.
	const totals = new Map<string, number>();
	for (const row of rows) {
		totals.set(row.day, (totals.get(row.day) ?? 0) + row.count);
	}
	return window.map((day) => ({ day, count: totals.get(day) ?? 0 }));
}
