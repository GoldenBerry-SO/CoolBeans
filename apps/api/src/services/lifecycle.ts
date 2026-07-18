// ABOUTME: License lifecycle transitions (PRD §9, §13, §16) — disable and re-enable, with audit.
// ABOUTME: Payment webhooks and the admin API both disable through here so the trail is uniform.

import type { License } from '@coolbeans/db';
import { licenses } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { writeAudit } from '../store/audit.js';

export type DisableReason =
	| 'refund'
	| 'subscription_canceled'
	| 'manual'
	| 'trial_expired'
	| 'chargeback';

/** Disable a license (the single signal a client acts on to revoke access). Idempotent. */
export function disableLicense(
	deps: AppDeps,
	args: { license: License; reason: DisableReason; actor: string },
): License {
	const { db } = deps;
	// Idempotent: a second disable (e.g. refund after chargeback) records no new state change.
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
	if (!restoreAllowed(args.license.disabledReason, args.trigger)) return args.license;
	return enableLicense(deps, { license: args.license, actor: args.actor });
}

/** Re-enable a disabled license, clearing the disabled fields. */
export function enableLicense(deps: AppDeps, args: { license: License; actor: string }): License {
	const { db } = deps;
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
