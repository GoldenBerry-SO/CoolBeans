// ABOUTME: Daily validation stats per product (issues #37, #101) — what the Overview chart draws.
// ABOUTME: Cheap writes on the hot path; a stats failure must never fail the validation itself.

import { validationCounters, validationSeen } from '@coolbeans/db';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';

/** UTC calendar day for a moment, YYYY-MM-DD. */
function dayOf(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/**
 * Record one check. Called on the hot path, so it is two cheap idempotent statements and
 * any failure is swallowed: broken stats must never turn a healthy licence check into an
 * error. The seen-set insert is what makes "distinct licences per day" countable without
 * logging a row per check (#101); the counter carries volume and the refused split.
 */
export async function recordValidation(
	deps: AppDeps,
	args: { productId: number; licenseId: number; refused: boolean },
): Promise<void> {
	const day = dayOf(nowDate(deps));
	try {
		await deps.db
			.insert(validationCounters)
			.values({
				productId: args.productId,
				day,
				count: 1,
				refused: args.refused ? 1 : 0,
			})
			.onConflictDoUpdate({
				target: [validationCounters.productId, validationCounters.day],
				set: {
					count: sql`${validationCounters.count} + 1`,
					...(args.refused ? { refused: sql`${validationCounters.refused} + 1` } : {}),
				},
			});
		await deps.db
			.insert(validationSeen)
			.values({ productId: args.productId, day, licenseId: args.licenseId })
			.onConflictDoNothing();
	} catch (err) {
		deps.logger.error('Validation stats write failed', { message: (err as Error).message });
	}
}

export interface ValidationDay {
	day: string;
	/** Distinct licences that checked in — the number a vendor can actually read. */
	licenses: number;
	/** Raw check volume; one chatty install can inflate this, which is why it is not the bar. */
	checks: number;
	/** Checks that answered valid:false — lapsed or revoked keys still being tried. */
	refused: number;
}

/**
 * The last N days of validation stats, oldest first, with missing days filled as zero so
 * the chart has no gaps.
 *
 * Pass `productId` for one product, or `productIds` to total across a set (an account's
 * products). Passing neither totals across the whole instance, which only the self-host
 * single-account case should be doing.
 */
export async function recentValidationCounts(
	deps: AppDeps,
	args: { days: number; productId?: number; productIds?: number[] },
): Promise<ValidationDay[]> {
	const today = nowDate(deps);
	const window: string[] = [];
	for (let i = args.days - 1; i >= 0; i -= 1) {
		const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
		window.push(dayOf(d));
	}
	const empty = () => window.map((day) => ({ day, licenses: 0, checks: 0, refused: 0 }));

	const oldest = window[0] ?? dayOf(today);
	// An empty productIds list means the account owns nothing, which is not the same as
	// "no filter" — without this it would fall through and total the whole instance.
	if (args.productIds && args.productIds.length === 0) return empty();

	const counterScope =
		args.productId !== undefined
			? eq(validationCounters.productId, args.productId)
			: args.productIds
				? inArray(validationCounters.productId, args.productIds)
				: undefined;
	const counterRows = await deps.db
		.select({
			day: validationCounters.day,
			count: validationCounters.count,
			refused: validationCounters.refused,
		})
		.from(validationCounters)
		.where(
			counterScope
				? and(gte(validationCounters.day, oldest), counterScope)
				: gte(validationCounters.day, oldest),
		);

	const seenScope =
		args.productId !== undefined
			? eq(validationSeen.productId, args.productId)
			: args.productIds
				? inArray(validationSeen.productId, args.productIds)
				: undefined;
	// COUNT(DISTINCT) per day across the whole scope: a licence belongs to exactly one
	// product, so no scope can double-count one licence on one day.
	const seenRows = await deps.db
		.select({
			day: validationSeen.day,
			licenses: sql<number>`COUNT(DISTINCT ${validationSeen.licenseId})`,
		})
		.from(validationSeen)
		.where(
			seenScope ? and(gte(validationSeen.day, oldest), seenScope) : gte(validationSeen.day, oldest),
		)
		.groupBy(validationSeen.day);

	// Several products can share a day, so total rather than overwrite.
	const checks = new Map<string, number>();
	const refused = new Map<string, number>();
	for (const row of counterRows) {
		checks.set(row.day, (checks.get(row.day) ?? 0) + row.count);
		refused.set(row.day, (refused.get(row.day) ?? 0) + row.refused);
	}
	const licenses = new Map<string, number>();
	for (const row of seenRows) {
		// COUNT comes back as a bigint string on postgres-js.
		licenses.set(row.day, Number(row.licenses));
	}
	return window.map((day) => ({
		day,
		licenses: licenses.get(day) ?? 0,
		checks: checks.get(day) ?? 0,
		refused: refused.get(day) ?? 0,
	}));
}
