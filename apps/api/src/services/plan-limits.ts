// ABOUTME: Hosted plan limits — what Free may create, and how much of it an account has used.
// ABOUTME: Self-host is unlimited by falling through this same path, never by a parallel branch.

import type { Account, Database } from '@coolbeans/db';
import { accounts, licenses, products } from '@coolbeans/db';
import { and, count, eq, isNull } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';

export type BillingPlan = 'free' | 'pro';

export interface PlanLimits {
	/** Live (unarchived) products an account may own. Null means no cap. */
	products: number | null;
	/** Active licences across all of the account's products. Null means no cap. */
	activeLicenses: number | null;
}

/**
 * Null rather than Infinity for "unlimited": Infinity does not survive JSON.stringify
 * (it serializes to null anyway), and null is already how this codebase puts "no cap" on
 * the wire — the console's usage meters render `limit === null` as "no cap" today.
 */
export const PLAN_LIMITS: Record<BillingPlan, PlanLimits> = {
	free: { products: 1, activeLicenses: 500 },
	pro: { products: null, activeLicenses: null },
};

const UNLIMITED: PlanLimits = { products: null, activeLicenses: null };

/**
 * Whether this instance bills anyone. Keyed off `config.billing` and never off
 * `config.stripe`: a self-hoster selling their own software sets STRIPE_SECRET_KEY and
 * must not land on the hosted billing path or behind its limits.
 */
export function isBillingEnabled(deps: Pick<AppDeps, 'config'>): boolean {
	return Boolean(deps.config.billing);
}

/**
 * The limits in force for an account. Self-host (no billing configured) is unlimited by
 * PRD §7, and gets there through this function rather than through a separate branch that
 * could rot apart from the real one.
 *
 * A past-due account keeps its Pro limits: tightening them because a card expired is
 * exactly the sort of thing that ruins a customer's day mid-dunning.
 */
export function limitsFor(deps: Pick<AppDeps, 'config'>, account: Account): PlanLimits {
	if (!isBillingEnabled(deps)) return UNLIMITED;
	const base = PLAN_LIMITS[account.plan];
	return {
		// A per-account override wins over the plan default, which is how a support gesture
		// is expressed without inventing a third plan.
		products: account.productLimit ?? base.products,
		activeLicenses: account.activeLicenseLimit ?? base.activeLicenses,
	};
}

/** Live products an account owns. Archived ones do not count, so archiving frees a slot. */
export function countLiveProducts(db: Database, accountId: number): number {
	return (
		db
			.select({ n: count() })
			.from(products)
			.where(and(eq(products.accountId, accountId), isNull(products.archivedAt)))
			.get()?.n ?? 0
	);
}

/**
 * Active licences across every product the account owns.
 *
 * Slightly stale-high: trial licences are only disabled lazily on validate and by the
 * sweep, so a just-expired trial can still be counted here. That is the right direction
 * to be wrong in — the next sweep corrects it in the customer's favour, and counting
 * "truly" would mean running expiry logic on a counting path.
 */
export function countActiveLicenses(db: Database, accountId: number): number {
	return (
		db
			.select({ n: count() })
			.from(licenses)
			.innerJoin(products, eq(products.id, licenses.productId))
			.where(and(eq(products.accountId, accountId), eq(licenses.status, 'active')))
			.get()?.n ?? 0
	);
}

export interface Usage {
	current: number;
	limit: number | null;
}

/** True when one more of a thing would still be within the limit. Null limit always fits. */
export function withinLimit(usage: Usage): boolean {
	return usage.limit === null || usage.current < usage.limit;
}

/** Products and active licences an account has used, against the limits in force. */
export function planUsage(
	deps: Pick<AppDeps, 'config' | 'db'>,
	account: Account,
): { products: Usage; activeLicenses: Usage } {
	const limits = limitsFor(deps, account);
	return {
		products: { current: countLiveProducts(deps.db, account.id), limit: limits.products },
		activeLicenses: {
			current: countActiveLicenses(deps.db, account.id),
			limit: limits.activeLicenses,
		},
	};
}

/** Stamp the moment an account first went over a limit, for the console banner. Idempotent. */
export function markOverLimit(deps: Pick<AppDeps, 'db'>, accountId: number, at: string): void {
	deps.db
		.update(accounts)
		.set({ overLimitSince: at })
		.where(and(eq(accounts.id, accountId), isNull(accounts.overLimitSince)))
		.run();
}
