// ABOUTME: Reconciles terminal payment events that arrived before their purchase (issue #34).
// ABOUTME: Stripe does not guarantee order, so a refund can land before the checkout that issued.

import type { License } from '@coolbeans/db';
import { pendingRevocations } from '@coolbeans/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { findLicenseByProviderId } from '../store/payment-lookup.js';
import { type DisableReason, disableLicense } from './lifecycle.js';

type Provider = 'stripe' | 'paypal';

/**
 * Remember a revocation whose license does not exist yet. Idempotent on (provider,
 * reference, reason): redelivery cannot stack rows, while a refund and chargeback may
 * coexist because clearing one cause must not silently discard the other.
 */
export async function recordPendingRevocation(
	deps: AppDeps,
	args: { provider: Provider; reference: string; reason: DisableReason; eventId: string },
): Promise<void> {
	await deps.db
		.insert(pendingRevocations)
		.values({
			provider: args.provider,
			reference: args.reference,
			reason: args.reason,
			eventId: args.eventId,
		})
		.onConflictDoNothing();

	// Look again now the row is committed. Issuance and this handler are not one
	// transaction, so a checkout that ran between our lookup and this insert would have
	// seen no pending row while we saw no licence, and the revocation would sit here
	// forever. Whichever side goes second finds the other's write.
	const found = await findLicenseByProviderId(deps, args.reference);
	if (found) {
		await applyPendingRevocation(deps, {
			license: found.license,
			provider: args.provider,
			references: [args.reference],
		});
	}
}

/**
 * Forget a parked revocation because the thing behind it went away — we won the dispute
 * before the checkout ever landed. Leaving it would revoke a licence for a customer who
 * paid, on the strength of a chargeback that no longer stands.
 */
export async function dropPendingRevocation(
	deps: AppDeps,
	args: { provider: Provider; reference: string; reason: DisableReason },
): Promise<void> {
	await deps.db
		.delete(pendingRevocations)
		.where(
			and(
				eq(pendingRevocations.provider, args.provider),
				eq(pendingRevocations.reference, args.reference),
				eq(pendingRevocations.reason, args.reason),
				isNull(pendingRevocations.consumedAt),
			),
		);
}

/**
 * Apply any revocation that was recorded before this license existed. Called right after
 * issuance: without it the checkout behind an early refund hands out a working key for
 * money we already gave back.
 *
 * Checks every id the payment could have been recorded under, since a refund names a
 * payment intent while a cancellation names a subscription.
 */
export async function applyPendingRevocation(
	deps: AppDeps,
	args: { license: License; provider: Provider; references: Array<string | null | undefined> },
): Promise<License> {
	const refs = args.references.filter((r): r is string => Boolean(r));
	if (refs.length === 0) return args.license;

	let license = args.license;
	for (const reference of refs) {
		// Every outstanding cause, not just the first. A refund and a chargeback can both
		// be parked against one payment, and leaving either unconsumed would let a later
		// restore hand back access the other one still forbids.
		const rows = await deps.db
			.select()
			.from(pendingRevocations)
			.where(
				and(
					eq(pendingRevocations.provider, args.provider),
					eq(pendingRevocations.reference, reference),
					isNull(pendingRevocations.consumedAt),
				),
			);

		for (const row of rows) {
			license = await disableLicense(deps, {
				license,
				reason: row.reason as DisableReason,
				actor: `${args.provider}:${row.eventId}`,
			});
			await deps.db
				.update(pendingRevocations)
				.set({ consumedAt: nowDate(deps).toISOString() })
				.where(eq(pendingRevocations.id, row.id));
		}
	}
	return license;
}
