// ABOUTME: Audit log writes (PRD §16) — every state change records action, actor, and JSON detail.
// ABOUTME: One helper so services never forget the trail; provider_events covers payment audit.

import type { Database } from '@coolbeans/db';
import { auditLog } from '@coolbeans/db';

export interface AuditEntry {
	action: string;
	actor: string;
	/**
	 * The account this happened in — the admin audit feed is scoped by it, so a row filed
	 * under the wrong account is invisible to its owner and visible to a stranger (#99).
	 * Required so no caller can forget: an event with no natural account (instance-level
	 * ops, an unroutable webhook) says DEFAULT_ACCOUNT_ID explicitly.
	 */
	accountId: number;
	productId?: number | null;
	licenseId?: number | null;
	detail?: Record<string, unknown>;
}

type AuditDb = Pick<Database, 'insert'>;

export async function writeAudit(db: AuditDb, entry: AuditEntry): Promise<void> {
	await db.insert(auditLog).values({
		accountId: entry.accountId,
		action: entry.action,
		actor: entry.actor,
		productId: entry.productId ?? null,
		licenseId: entry.licenseId ?? null,
		detail: entry.detail ? JSON.stringify(entry.detail) : null,
	});
}

type AuditLogger = { error(message: string, fields?: Record<string, unknown>): void };

/**
 * Audit for the public client path (PRD §9). By the time these write, the seat change has
 * already committed — a customer whose activation succeeded must never see a 500 because
 * the trail insert hiccuped. The trail is for the vendor; the seat is for the customer.
 */
export async function writeAuditBestEffort(
	db: AuditDb,
	logger: AuditLogger,
	entry: AuditEntry,
): Promise<void> {
	try {
		await writeAudit(db, entry);
	} catch (err) {
		logger.error('Audit write failed; the client call still succeeds', {
			action: entry.action,
			error: String(err),
		});
	}
}
