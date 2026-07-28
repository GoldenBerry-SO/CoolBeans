// ABOUTME: Retention prune (issue #49, ARCHITECTURE "Retention") — ages out provider_events.
// ABOUTME: audit_log is deliberately never pruned: it is the operator's record of who did what.

import { affected, providerEvents } from '@coolbeans/db';
import { and, eq, lt } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { DEFAULT_ACCOUNT_ID } from '../store/accounts.js';
import { writeAudit } from '../store/audit.js';

/**
 * How long a processed provider event is kept. Stripe gives up retrying after about
 * three days, so thirty is far outside every provider's retry window: a redelivery this
 * old will not arrive, and dropping the row cannot weaken idempotency.
 */
export const PROVIDER_EVENT_RETENTION_DAYS = 30;

/**
 * Delete finished provider events past the retention window. Returns how many went.
 *
 * Only 'done' rows are eligible. A row still marked 'processing' is either genuinely in
 * flight or a stuck claim worth investigating; deleting it would let the same event run
 * a second time and issue a duplicate key.
 */
export async function pruneProviderEvents(deps: AppDeps): Promise<number> {
	const cutoff = new Date(
		nowDate(deps).getTime() - PROVIDER_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
	).toISOString();

	const result = await deps.db
		.delete(providerEvents)
		.where(and(eq(providerEvents.status, 'done'), lt(providerEvents.receivedAt, cutoff)))
		.returning({ id: providerEvents.id });
	const deleted = affected(result);

	// Rows vanishing from the idempotency table is a state change; §16 wants it explained.
	if (deleted > 0) {
		await writeAudit(deps.db, {
			action: 'provider_events.pruned',
			actor: 'system',
			// Instance-level housekeeping with no single owner; filed under the default
			// account, which is the operator's on self-host and ours on cloud.
			accountId: DEFAULT_ACCOUNT_ID,
			detail: { deleted, older_than: cutoff },
		});
	}
	return deleted;
}
