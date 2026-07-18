// ABOUTME: Reconciles terminal payment events that arrived before their purchase (issue #34).
// ABOUTME: Stripe does not guarantee order, so a refund can land before the checkout that issued.

import type { License } from '@coolbeans/db';
import { pendingRevocations } from '@coolbeans/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { type DisableReason, disableLicense } from './lifecycle.js';

type Provider = 'stripe' | 'paypal';

/**
 * Remember a revocation whose license does not exist yet. Idempotent on (provider,
 * reference): a redelivered refund must not stack up rows, and the first reason wins
 * because a chargeback following a refund revokes for the same money either way.
 */
export function recordPendingRevocation(
	deps: AppDeps,
	args: { provider: Provider; reference: string; reason: DisableReason; eventId: string },
): void {
	deps.db
		.insert(pendingRevocations)
		.values({
			provider: args.provider,
			reference: args.reference,
			reason: args.reason,
			eventId: args.eventId,
		})
		.onConflictDoNothing()
		.run();
}

/**
 * Apply any revocation that was recorded before this license existed. Called right after
 * issuance: without it the checkout behind an early refund hands out a working key for
 * money we already gave back.
 *
 * Checks every id the payment could have been recorded under, since a refund names a
 * payment intent while a cancellation names a subscription.
 */
export function applyPendingRevocation(
	deps: AppDeps,
	args: { license: License; provider: Provider; references: Array<string | null | undefined> },
): License {
	const refs = args.references.filter((r): r is string => Boolean(r));
	if (refs.length === 0) return args.license;

	for (const reference of refs) {
		const row = deps.db
			.select()
			.from(pendingRevocations)
			.where(
				and(
					eq(pendingRevocations.provider, args.provider),
					eq(pendingRevocations.reference, reference),
					isNull(pendingRevocations.consumedAt),
				),
			)
			.get();
		if (!row) continue;

		const disabled = disableLicense(deps, {
			license: args.license,
			reason: row.reason as DisableReason,
			actor: `${args.provider}:${row.eventId}`,
		});
		deps.db
			.update(pendingRevocations)
			.set({ consumedAt: nowDate(deps).toISOString() })
			.where(eq(pendingRevocations.id, row.id))
			.run();
		return disabled;
	}
	return args.license;
}
