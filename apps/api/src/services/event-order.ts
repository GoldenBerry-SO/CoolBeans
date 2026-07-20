// ABOUTME: Subscription event ordering (issue #54) — arrival order is not event order.
// ABOUTME: Stripe retries for days, so a stale 'active' can land after the cancellation.

import { purchases } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';

/**
 * Should an event with this timestamp be applied, given the newest one already applied?
 *
 * Pure, because both ways of getting it wrong are expensive: too strict and a real
 * cancellation is dropped, too loose and a stale event resurrects a dead licence.
 *
 * Equal timestamps are applied. Stripe stamps in whole seconds, so two events in the same
 * second are genuinely ambiguous and dropping the second one would lose real transitions.
 */
export function shouldApplySubscriptionEvent(
	eventCreated: number | undefined,
	lastApplied: number | null | undefined,
): boolean {
	// An event with no timestamp (an old delivery, a hand-made replay) is applied rather
	// than dropped: refusing it silently is worse than applying it in arrival order.
	if (eventCreated === undefined) return true;
	if (lastApplied === null || lastApplied === undefined) return true;
	return eventCreated >= lastApplied;
}

/**
 * The newest subscription event applied to this subscription, if we have seen one.
 *
 * Ordering is tracked on the purchase, so it only starts once the checkout has landed.
 * Subscription events arriving before that are applied in arrival order. In practice a
 * checkout webhook lands within seconds while a lapse takes days, so the window where
 * that matters is not one real customers hit.
 */
export async function lastSubscriptionEventAt(
	deps: AppDeps,
	subscriptionId: string,
): Promise<number | null> {
	const [row] = await deps.db
		.select({ at: purchases.lastSubscriptionEventAt })
		.from(purchases)
		.where(eq(purchases.providerSubscriptionId, subscriptionId))
		.limit(1);
	return row?.at ?? null;
}

/** Remember this event as the newest applied, so a later stale delivery is ignored. */
export async function markSubscriptionEventApplied(
	deps: AppDeps,
	subscriptionId: string,
	eventCreated: number | undefined,
): Promise<void> {
	if (eventCreated === undefined) return;
	await deps.db
		.update(purchases)
		.set({ lastSubscriptionEventAt: eventCreated })
		.where(eq(purchases.providerSubscriptionId, subscriptionId));
}
