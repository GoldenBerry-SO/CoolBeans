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
