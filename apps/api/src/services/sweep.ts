// ABOUTME: Periodic sweeps (PRD §17) — disable expired trials and reap dead floating leases.
// ABOUTME: Trial expiry is enforced lazily at validate too; the sweep keeps state consistent offline.

import { activations, licenses, products } from '@coolbeans/db';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { writeAudit } from '../store/audit.js';
import { pruneProviderEvents } from './prune.js';

/** Disable every active trial whose expires_at has passed. Returns the count disabled. */
export function sweepExpiredTrials(deps: AppDeps): number {
	const nowIso = nowDate(deps).toISOString();
	const due = deps.db
		.select()
		.from(licenses)
		.where(
			and(
				eq(licenses.tier, 'trial'),
				eq(licenses.status, 'active'),
				isNotNull(licenses.expiresAt),
				lt(licenses.expiresAt, nowIso),
			),
		)
		.all();
	for (const license of due) {
		deps.db
			.update(licenses)
			.set({ status: 'disabled', disabledAt: nowIso, disabledReason: 'trial_expired' })
			.where(eq(licenses.id, license.id))
			.run();
		writeAudit(deps.db, {
			action: 'license.disabled',
			actor: 'system',
			productId: license.productId,
			licenseId: license.id,
			detail: { reason: 'trial_expired', swept: true },
		});
	}
	return due.length;
}

/** Mark expired floating leases deactivated so seat counts and listings stay tidy. */
export function reapFloatingLeases(deps: AppDeps): number {
	const nowIso = nowDate(deps).toISOString();
	const result = deps.db
		.update(activations)
		.set({ deactivatedAt: nowIso })
		.where(
			and(
				sql`${activations.deactivatedAt} IS NULL`,
				isNotNull(activations.leaseExpiresAt),
				lt(activations.leaseExpiresAt, nowIso),
				sql`${activations.licenseId} IN (SELECT id FROM licenses WHERE product_id IN (SELECT id FROM ${products} WHERE activation_model = 'floating'))`,
			),
		)
		.run();
	// §16 says every state change is auditable; an automated seat release is a state
	// change even though no human asked for it.
	if (result.changes > 0) {
		writeAudit(deps.db, {
			action: 'lease.reaped',
			actor: 'system',
			detail: { seats_freed: result.changes },
		});
	}
	return result.changes;
}

/** Run all periodic sweeps. Scheduled by the worker (BullMQ repeatable) in production. */
export function runSweeps(deps: AppDeps): { trials: number; leases: number; pruned: number } {
	return {
		trials: sweepExpiredTrials(deps),
		leases: reapFloatingLeases(deps),
		pruned: pruneProviderEvents(deps),
	};
}
