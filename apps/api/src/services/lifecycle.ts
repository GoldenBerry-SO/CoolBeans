// ABOUTME: License lifecycle transitions (PRD §9, §13, §16) — disable and re-enable, with audit.
// ABOUTME: Payment webhooks and the admin API both disable through here so the trail is uniform.

import type { License } from '@coolbeans/db';
import { licenseRevocations, licenses } from '@coolbeans/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { DEFAULT_ACCOUNT_ID } from '../store/accounts.js';
import { writeAudit } from '../store/audit.js';
import { getProductById } from '../store/products.js';

/**
 * The account a licence belongs to, via its product. Lifecycle callers hold only the
 * licence row (webhooks resolve by provider id), so the audit account is looked up here
 * rather than threaded through every caller. Falls back to the default account only if
 * the product row is gone, which the FK makes impossible in practice.
 */
async function accountIdOf(deps: AppDeps, license: License): Promise<number> {
	const product = await getProductById(deps.db, license.productId);
	return product?.accountId ?? DEFAULT_ACCOUNT_ID;
}

export type DisableReason =
	| 'refund'
	| 'subscription_canceled'
	| 'manual'
	| 'trial_expired'
	| 'chargeback';

/** Record a cause as outstanding. Idempotent per (license, cause). */
async function openCause(
	deps: AppDeps,
	license: License,
	cause: DisableReason,
	actor: string,
): Promise<void> {
	const [existing] = await deps.db
		.select()
		.from(licenseRevocations)
		.where(
			and(
				eq(licenseRevocations.licenseId, license.id),
				eq(licenseRevocations.cause, cause),
				isNull(licenseRevocations.clearedAt),
			),
		)
		.limit(1);
	if (existing) return;
	await deps.db
		.insert(licenseRevocations)
		.values({ licenseId: license.id, cause, actor, createdAt: nowDate(deps).toISOString() });
}

/** Causes still standing against a license. */
async function openCauses(deps: AppDeps, licenseId: number): Promise<string[]> {
	const rows = await deps.db
		.select({ cause: licenseRevocations.cause })
		.from(licenseRevocations)
		.where(and(eq(licenseRevocations.licenseId, licenseId), isNull(licenseRevocations.clearedAt)));
	return rows.map((r) => r.cause);
}

/** Disable a license (the single signal a client acts on to revoke access). Idempotent. */
export async function disableLicense(
	deps: AppDeps,
	args: { license: License; reason: DisableReason; actor: string },
): Promise<License> {
	const { db } = deps;
	// Always record the cause, even when already disabled: two things can revoke at once
	// and clearing one of them must not hand access back while the other still stands.
	await openCause(deps, args.license, args.reason, args.actor);
	if (args.license.status === 'disabled') return args.license;
	const disabledAt = nowDate(deps).toISOString();
	await db
		.update(licenses)
		.set({ status: 'disabled', disabledAt, disabledReason: args.reason })
		.where(eq(licenses.id, args.license.id));
	await writeAudit(db, {
		action: 'license.disabled',
		actor: args.actor,
		accountId: await accountIdOf(deps, args.license),
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
export async function restoreLicense(
	deps: AppDeps,
	args: { license: License; trigger: RestoreTrigger; actor: string },
): Promise<License> {
	if (args.license.status !== 'disabled') return args.license;

	// Clear only the cause this trigger owns. A licence disabled for a chargeback AND a
	// cancellation is still cancelled after we win the dispute.
	const cleared = (await openCauses(deps, args.license.id)).filter((cause) =>
		restoreAllowed(cause, args.trigger),
	);
	if (cleared.length === 0) {
		// Nothing recorded (a licence disabled before this table existed): fall back to
		// the single reason on the row so old data still recovers.
		if (!restoreAllowed(args.license.disabledReason, args.trigger)) return args.license;
	}
	for (const cause of cleared) {
		await deps.db
			.update(licenseRevocations)
			.set({ clearedAt: nowDate(deps).toISOString() })
			.where(
				and(
					eq(licenseRevocations.licenseId, args.license.id),
					eq(licenseRevocations.cause, cause),
					isNull(licenseRevocations.clearedAt),
				),
			);
	}

	const remaining = await openCauses(deps, args.license.id);
	if (remaining.length > 0) {
		deps.logger.info('Licence stays disabled: another cause is still outstanding', {
			license: args.license.id,
			remaining,
		});
		return args.license;
	}
	return await enableLicense(deps, { license: args.license, actor: args.actor });
}

/** Re-enable a disabled license, clearing the disabled fields. */
export async function enableLicense(
	deps: AppDeps,
	args: { license: License; actor: string },
): Promise<License> {
	const { db } = deps;
	// An explicit re-enable overrides every outstanding cause: a human looked at it and
	// decided. Leaving causes open would let the next payment event re-disable silently.
	await db
		.update(licenseRevocations)
		.set({ clearedAt: nowDate(deps).toISOString() })
		.where(
			and(eq(licenseRevocations.licenseId, args.license.id), isNull(licenseRevocations.clearedAt)),
		);
	await db
		.update(licenses)
		.set({ status: 'active', disabledAt: null, disabledReason: null })
		.where(eq(licenses.id, args.license.id));
	await writeAudit(db, {
		action: 'license.reenabled',
		actor: args.actor,
		accountId: await accountIdOf(deps, args.license),
		productId: args.license.productId,
		licenseId: args.license.id,
	});
	return { ...args.license, status: 'active', disabledAt: null, disabledReason: null };
}
