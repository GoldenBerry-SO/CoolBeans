// ABOUTME: Retention prune (issues #49, #141) — ages out provider_events and webhook_deliveries.
// ABOUTME: audit_log is deliberately never pruned: it is the operator's record of who did what.

import { affected, providerEvents, webhookDeliveries } from '@coolbeans/db';
import { and, eq, inArray, lt } from 'drizzle-orm';
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

/**
 * How long a finished webhook delivery is kept. Deliberately the same window as its
 * sibling above rather than a second policy: both tables hold rows that were only ever
 * needed briefly, and two numbers is one to forget to change.
 */
export const WEBHOOK_DELIVERY_RETENTION_DAYS = PROVIDER_EVENT_RETENTION_DAYS;

/**
 * Delete finished webhook deliveries past the retention window. Returns how many went.
 *
 * Only terminal rows are eligible. A 'pending' row still owes a retry and its stored
 * payload is the only copy of the body: it cannot be rebuilt from current state, because
 * state may have moved on since the event fired (the licence may since have been
 * disabled) and at-least-once delivery has to send the event as it was, not as things are
 * now. Same reasoning as the 'processing' exclusion above.
 *
 * This is also what keeps buyer emails in those payloads from being kept indefinitely.
 *
 * The window is measured from createdAt, when the event fired, not from when delivery
 * happened to finish. That is deliberate: this is a retention policy over personal data,
 * so the clock should start when the address entered the table, not when we managed to
 * hand it over. The practical effect is a delivery that stayed pending for longer than the
 * window is eligible as soon as it settles, which needs the worker to have been down for a
 * month. In that situation the missing delivery log is not the problem worth solving.
 */
export async function pruneWebhookDeliveries(deps: AppDeps): Promise<number> {
	const cutoff = new Date(
		nowDate(deps).getTime() - WEBHOOK_DELIVERY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
	).toISOString();

	const result = await deps.db
		.delete(webhookDeliveries)
		.where(
			and(
				inArray(webhookDeliveries.status, ['delivered', 'failed']),
				lt(webhookDeliveries.createdAt, cutoff),
			),
		)
		.returning({ id: webhookDeliveries.id });
	const deleted = affected(result);

	if (deleted > 0) {
		await writeAudit(deps.db, {
			action: 'webhook_deliveries.pruned',
			actor: 'system',
			// Instance-level housekeeping, filed like its sibling: the deliveries span every
			// account, so no single one owns the row.
			accountId: DEFAULT_ACCOUNT_ID,
			detail: { deleted, older_than: cutoff },
		});
	}
	return deleted;
}
