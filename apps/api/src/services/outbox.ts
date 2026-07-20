// ABOUTME: Durable outbox (PRD §14, background jobs) — the source of truth for async work.
// ABOUTME: BullMQ is the wakeup; a lost queue message is recovered by claiming due outbox rows.

import { licenses, outbox, products } from '@coolbeans/db';
import { and, eq, lte } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate, withTx } from '../deps.js';
import { sendKeyEmail } from './email.js';

export type JobKind = 'send_key_email';

export interface SendKeyEmailPayload {
	licenseId: number;
	email: string;
}

/** Enqueue a job. Idempotent side effects are the job handler's responsibility. */
export async function enqueue(
	deps: AppDeps,
	kind: JobKind,
	payload: object,
	delayMs = 0,
): Promise<void> {
	const runAfter = new Date(nowDate(deps).getTime() + delayMs).toISOString();
	await deps.db.insert(outbox).values({ kind, payload: JSON.stringify(payload), runAfter });
}

/** How long a claim may sit in `processing` before it is presumed dead and requeued. */
const STALE_CLAIM_MS = 5 * 60_000;

/** Claim up to `limit` due pending jobs, marking them processing with a claim timestamp. */
export async function claimDue(deps: AppDeps, limit = 10) {
	const nowIso = nowDate(deps).toISOString();
	return await deps.db.transaction(async (tx) => {
		const scoped = withTx(deps, tx);
		// Recover claims from crashed workers: anything processing past the lease window
		// returns to pending so the outbox stays durable (a claim is a lease, not a tombstone).
		const staleBefore = new Date(nowDate(deps).getTime() - STALE_CLAIM_MS).toISOString();
		await scoped.db
			.update(outbox)
			.set({ status: 'pending', claimedAt: null })
			.where(and(eq(outbox.status, 'processing'), lte(outbox.claimedAt, staleBefore)));

		const due = await scoped.db
			.select()
			.from(outbox)
			.where(and(eq(outbox.status, 'pending'), lte(outbox.runAfter, nowIso)))
			.limit(limit);
		for (const job of due) {
			await scoped.db
				.update(outbox)
				.set({ status: 'processing', claimedAt: nowIso })
				.where(eq(outbox.id, job.id));
		}
		return due;
	});
}

async function markDone(deps: AppDeps, id: number): Promise<void> {
	await deps.db
		.update(outbox)
		.set({ status: 'done', processedAt: nowDate(deps).toISOString() })
		.where(eq(outbox.id, id));
}

async function markFailed(
	deps: AppDeps,
	id: number,
	error: string,
	attempts: number,
): Promise<void> {
	// Back off and retry a few times before giving up.
	const status = attempts >= 5 ? 'failed' : 'pending';
	const runAfter = new Date(nowDate(deps).getTime() + attempts * 60_000).toISOString();
	await deps.db
		.update(outbox)
		.set({ status, attempts, lastError: error, runAfter })
		.where(eq(outbox.id, id));
}

/** Process one claimed job. Idempotent: re-running a send checks email_sent_at first. */
export async function processJob(
	deps: AppDeps,
	job: { id: number; kind: string; payload: string; attempts: number },
): Promise<void> {
	try {
		if (job.kind === 'send_key_email') {
			const payload = JSON.parse(job.payload) as SendKeyEmailPayload;
			const [license] = await deps.db
				.select()
				.from(licenses)
				.where(eq(licenses.id, payload.licenseId))
				.limit(1);
			if (license?.status === 'active' && !license.emailSentAt) {
				const [product] = await deps.db
					.select()
					.from(products)
					.where(eq(products.id, license.productId))
					.limit(1);
				if (product) await sendKeyEmail(deps, { license, product, email: payload.email });
			}
		}
		await markDone(deps, job.id);
	} catch (err) {
		await markFailed(
			deps,
			job.id,
			err instanceof Error ? err.message : String(err),
			job.attempts + 1,
		);
	}
}

/** Drain all due jobs once. Called by the worker on each tick and as a webhook backstop. */
export async function drainOutbox(deps: AppDeps): Promise<number> {
	const jobs = await claimDue(deps);
	for (const job of jobs) await processJob(deps, job);
	return jobs.length;
}
