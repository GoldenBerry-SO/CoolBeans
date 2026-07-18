// ABOUTME: Audit log writes (PRD §16) — every state change records action, actor, and JSON detail.
// ABOUTME: One helper so services never forget the trail; provider_events covers payment audit.

import type { Database } from '@coolbeans/db';
import { auditLog } from '@coolbeans/db';

export interface AuditEntry {
	action: string;
	actor: string;
	productId?: number | null;
	licenseId?: number | null;
	detail?: Record<string, unknown>;
}

type AuditDb = Pick<Database, 'insert'>;

export function writeAudit(db: AuditDb, entry: AuditEntry): void {
	db.insert(auditLog)
		.values({
			action: entry.action,
			actor: entry.actor,
			productId: entry.productId ?? null,
			licenseId: entry.licenseId ?? null,
			detail: entry.detail ? JSON.stringify(entry.detail) : null,
		})
		.run();
}
