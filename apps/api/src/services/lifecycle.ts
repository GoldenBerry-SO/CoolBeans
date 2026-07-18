// ABOUTME: License lifecycle transitions (PRD §9, §13, §16) — disable and re-enable, with audit.
// ABOUTME: Payment webhooks and the admin API both disable through here so the trail is uniform.

import type { License } from '@coolbeans/db';
import { licenseRevocations, licenses } from '@coolbeans/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { writeAudit } from '../store/audit.js';

export type DisableReason =
	| 'refund'
	| 'subscription_canceled'
	| 'manual'
	| 'trial_expired'
	| 'chargeback';

/** Record a cause as outstanding. Idempotent per (license, cause). */
function openCause(deps: AppDeps, license: License, cause: DisableReason, actor: string): void {
	const existing = deps.db
		.select()
		.from(licenseRevocations)
		.where(
			and(
				eq(licenseRevocations.licenseId, license.id),
				eq(licenseRevocations.cause, cause),
				isNull(licenseRevocations.clearedAt),
			),
		)
		.get();
	if (existing) return;
	deps.db
		.insert(licenseRevocations)
		.values({ licenseId: license.id, cause, actor, createdAt: nowDate(deps).toISOString() })
		.run();
}

/** Causes still standing against a license. */
function openCauses(deps: AppDeps, licenseId: number): string[] {
	return deps.db
		.select({ cause: licenseRevocations.cause })
		.from(licenseRevocations)
		.where(and(eq(licenseRevocations.licenseId, licenseId), isNull(licenseRevocations.clearedAt)))
		.all()
		.map((r) => r.cause);
}

/** Disable a license (the single signal a client acts on to revoke access). Idempotent. */
export function disableLicense(
	deps: AppDeps,
	args: { license: License; reason: DisableReason; actor: string },
): License {
	const { db } = deps;
	// Always record the cause, even when already disabled: two things can revoke at once
	// and clearing one of them must not hand access back while the other still stands.
	openCause(deps, args.license, args.reason, args.actor);
	if (args.license.status === 'disabled') return args.license;
	const disabledAt = nowDate(deps).toISOString();
	db.update(licenses)
		.set({ status: 'disabled', disabledAt, disabledReason: args.reason })
		.where(eq(licenses.id, args.license.id))
		.run();
	writeAudit(db, {
		action: 'license.disabled',
		actor: args.actor,
		productId: args.license.productId,
		licenseId: args.license.id,
		detail: { reason: args.reason },
	});
	return { ...args.license, status: 'disabled', disabledAt, disabledReason: args.reason };
}

/**
 * What made a payment provider take access back. A trigger only undoes the disable it
 * caused, so a recovered subscription cannot resurrect a refunded key.
 */
export type RestoreTrigger = 'subscription_recovered' | 'dispute_won';

/**
 * May this trigger restore a license disabled for this reason?
 *
 * Pure so the policy can be tested directly: getting it wrong either locks out a paying
 * customer or hands access back to someone who took their money back, and neither shows
 * up in a happy-path test.
 */
export function restoreAllowed(reason: string | null, trigger: RestoreTrigger): boolean {
	if (reason === 'subscription_canceled') return trigger === 'subscription_recovered';
	if (reason === 'chargeback') return trigger === 'dispute_won';
	// A refund, a manual admin disable, and an expired trial are all decisions no
	// payment event should quietly reverse.
	return false;
}

/**
 * Undo a disable when the cause of it goes away — a subscriber pays up, or we win a
 * dispute. Does nothing unless the recorded reason matches the trigger.
 */
export function restoreLicense(
	deps: AppDeps,
	args: { license: License; trigger: RestoreTrigger; actor: string },
): License {
	if (args.license.status !== 'disabled') return args.license;

	// Clear only the cause this trigger owns. A licence disabled for a chargeback AND a
	// cancellation is still cancelled after we win the dispute.
	const cleared = openCauses(deps, args.license.id).filter((cause) =>
		restoreAllowed(cause, args.trigger),
	);
	if (cleared.length === 0) {
		// Nothing recorded (a licence disabled before this table existed): fall back to
		// the single reason on the row so old data still recovers.
		if (!restoreAllowed(args.license.disabledReason, args.trigger)) return args.license;
	}
	for (const cause of cleared) {
		deps.db
			.update(licenseRevocations)
			.set({ clearedAt: nowDate(deps).toISOString() })
			.where(
				and(
					eq(licenseRevocations.licenseId, args.license.id),
					eq(licenseRevocations.cause, cause),
					isNull(licenseRevocations.clearedAt),
				),
			)
			.run();
	}

	const remaining = openCauses(deps, args.license.id);
	if (remaining.length > 0) {
		deps.logger.info('Licence stays disabled: another cause is still outstanding', {
			license: args.license.id,
			remaining,
		});
		return args.license;
	}
	return enableLicense(deps, { license: args.license, actor: args.actor });
}

/** Re-enable a disabled license, clearing the disabled fields. */
export function enableLicense(deps: AppDeps, args: { license: License; actor: string }): License {
	const { db } = deps;
	// An explicit re-enable overrides every outstanding cause: a human looked at it and
	// decided. Leaving causes open would let the next payment event re-disable silently.
	db.update(licenseRevocations)
		.set({ clearedAt: nowDate(deps).toISOString() })
		.where(
			and(eq(licenseRevocations.licenseId, args.license.id), isNull(licenseRevocations.clearedAt)),
		)
		.run();
	db.update(licenses)
		.set({ status: 'active', disabledAt: null, disabledReason: null })
		.where(eq(licenses.id, args.license.id))
		.run();
	writeAudit(db, {
		action: 'license.reenabled',
		actor: args.actor,
		productId: args.license.productId,
		licenseId: args.license.id,
	});
	return { ...args.license, status: 'active', disabledAt: null, disabledReason: null };
}
