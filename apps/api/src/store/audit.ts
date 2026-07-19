// ABOUTME: Audit log writes (PRD §16) — every state change records action, actor, and JSON detail.
// ABOUTME: One helper so services never forget the trail; provider_events covers payment audit.

import type { Database } from '@coolbeans/db';
import { auditLog } from '@coolbeans/db';
import { DEFAULT_ACCOUNT_ID } from './accounts.js';

export interface AuditEntry {
	action: string;
	actor: string;
	/**
	 * The account this happened in. Carried directly because sign-in, invite and account
	 * rows have no product to derive it from. Defaults to the single self-host account,
	 * which is also what every pre-tenancy row was backfilled to.
	 */
	accountId?: number;
	productId?: number | null;
	licenseId?: number | null;
	detail?: Record<string, unknown>;
}

type AuditDb = Pick<Database, 'insert'>;

export function writeAudit(db: AuditDb, entry: AuditEntry): void {
	db.insert(auditLog)
		.values({
			accountId: entry.accountId ?? DEFAULT_ACCOUNT_ID,
			action: entry.action,
			actor: entry.actor,
			productId: entry.productId ?? null,
			licenseId: entry.licenseId ?? null,
			detail: entry.detail ? JSON.stringify(entry.detail) : null,
		})
		.run();
}
