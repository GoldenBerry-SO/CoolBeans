// ABOUTME: Shared payment issuance + lookup helpers (PRD §13) — provider-agnostic core.
// ABOUTME: ensureLicense is idempotent on provider_checkout_id; email failures leave email_sent_at NULL.

import type { License, Product } from '@coolbeans/db';
import { licenses, providerEvents, purchases } from '@coolbeans/db';
import { and, eq, or, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { writeAudit } from '../store/audit.js';
import { getProductById } from '../store/products.js';
import { sendKeyEmail } from './email.js';
import { createPurchase, issueLicense, type Tier } from './issuance.js';
import { enqueue } from './outbox.js';

/** Delay before the outbox backstop tries the key email, after inline send + provider retries. */
const EMAIL_BACKSTOP_DELAY_MS = 10 * 60_000;

export interface EnsureArgs {
	product: Product;
	provider: 'stripe' | 'paypal';
	checkoutId: string;
	tier: Tier;
	email: string;
	expiresAt?: string | null;
	customerId?: string | null;
	subscriptionId?: string | null;
	paymentId?: string | null;
	amountTotal?: number | null;
	currency?: string | null;
	/** The provider event that caused this issuance, for the audit trail (§16). */
	eventId?: string | null;
}

export interface EnsureResult {
	license: License;
	created: boolean;
}

/**
 * Idempotently ensure a license exists for a paid checkout, then (re)send the key email.
 * Whichever of {webhook, success page} runs first issues; the other reads. Throws if the
 * email send fails so the caller returns 500 and the provider retry re-attempts only email.
 */
export async function ensureLicense(deps: AppDeps, args: EnsureArgs): Promise<EnsureResult> {
	// A payment for an archived product should not happen (archiving is meant to stop
	// sales), but if a checkout link was still live we must not take the money and
	// deliver nothing. Issue, and make it loud enough that an operator notices.
	if (args.product.archivedAt) {
		deps.logger.error('Paid checkout for an archived product; issuing anyway', {
			product: args.product.slug,
			checkout: args.checkoutId,
		});
		writeAudit(deps.db, {
			action: 'license.issued_for_archived_product',
			actor: `${args.provider}:${args.eventId ?? args.checkoutId}`,
			productId: args.product.id,
			detail: { checkout: args.checkoutId, email: args.email },
		});
	}
	const { db } = deps;
	let created = false;

	let license = db
		.select()
		.from(licenses)
		.innerJoin(purchases, eq(purchases.id, licenses.purchaseId))
		.where(eq(purchases.providerCheckoutId, args.checkoutId))
		.get()?.licenses;

	if (!license) {
		try {
			// One transaction: a failure anywhere leaves no orphaned purchase behind, so a
			// provider retry re-enters this path cleanly instead of hitting a dead UNIQUE row.
			license = db.transaction((): License => {
				const purchase = createPurchase(deps, {
					productId: args.product.id,
					provider: args.provider,
					providerCheckoutId: args.checkoutId,
					providerCustomerId: args.customerId ?? null,
					providerSubscriptionId: args.subscriptionId ?? null,
					providerPaymentId: args.paymentId ?? null,
					email: args.email,
					amountTotal: args.amountTotal ?? null,
					currency: args.currency ?? null,
				});
				const issued = issueLicense(deps, {
					product: args.product,
					purchaseId: purchase.id,
					tier: args.tier,
					expiresAt: args.expiresAt,
					actor: `${args.provider}:${args.eventId ?? args.checkoutId}`,
				});
				// Durable backstop: if inline send and provider retries all fail, the worker sends later.
				enqueue(
					deps,
					'send_key_email',
					{ licenseId: issued.id, email: args.email },
					EMAIL_BACKSTOP_DELAY_MS,
				);
				return issued;
			});
			created = true;
		} catch (err) {
			// A concurrent insert won the checkout-id UNIQUE race; re-read the winner's license.
			if (err instanceof Error && /UNIQUE/i.test(err.message)) {
				license = db
					.select()
					.from(licenses)
					.innerJoin(purchases, eq(purchases.id, licenses.purchaseId))
					.where(eq(purchases.providerCheckoutId, args.checkoutId))
					.get()?.licenses;
			}
			if (!license) throw err;
		}
	}

	// Retry-only-email path: send if not yet sent. A failure propagates (caller returns 500).
	if (!license.emailSentAt && deps.email) {
		await sendKeyEmail(deps, { license, product: args.product, email: args.email });
	}

	return { license, created };
}

/** Find the license behind a purchase matched by any provider id (subscription/payment/checkout). */
export function findLicenseByProviderId(
	deps: AppDeps,
	providerId: string,
): { license: License; product: Product } | undefined {
	const row = deps.db
		.select()
		.from(licenses)
		.innerJoin(purchases, eq(purchases.id, licenses.purchaseId))
		.where(
			or(
				eq(purchases.providerSubscriptionId, providerId),
				eq(purchases.providerPaymentId, providerId),
				eq(purchases.providerCheckoutId, providerId),
			),
		)
		.get();
	if (!row) return undefined;
	const product = getProductById(deps.db, row.licenses.productId);
	return product ? { license: row.licenses, product } : undefined;
}

/** How long an in-flight claim is honoured before another delivery may take it over. */
const CLAIM_STALE_MS = 5 * 60_000;

/**
 * Take exclusive ownership of a provider event, or refuse when it is already done or
 * in flight. A single guarded INSERT decides it: two concurrent redeliveries cannot
 * both win, where the old read-then-write check let both through (issue #34).
 * A claim older than CLAIM_STALE_MS is reclaimable so a crash mid-handler cannot
 * wedge an event forever.
 */
export type ClaimResult = 'claimed' | 'done' | 'in_flight';

export interface Claim {
	result: ClaimResult;
	/** The claimed_at stamp that identifies this claimant, for fencing completion. */
	token?: string;
}

/**
 * As claimEvent, but distinguishing an event that already finished from one another
 * worker is holding. The difference matters: acknowledging an in-flight event tells the
 * provider to stop retrying, and if that worker crashed the work is lost forever.
 */
/**
 * How to read the event row after our claim was refused. A missing row means another
 * worker released it in the moment between the two statements, which is the middle of
 * someone else's attempt — NOT a finished event. Calling that 'done' would acknowledge
 * the delivery and lose the work, the exact failure the claim rewrite set out to fix.
 */
export function claimOutcomeForRow(row: { status: string } | undefined): ClaimResult {
	if (!row) return 'in_flight';
	return row.status === 'processing' ? 'in_flight' : 'done';
}

export function claimEventStatus(
	deps: AppDeps,
	event: { id: string; provider: string; type: string },
): Claim {
	if (claimEvent(deps, event)) {
		const row = deps.db.select().from(providerEvents).where(eq(providerEvents.id, event.id)).get();
		return { result: 'claimed', token: row?.claimedAt ?? undefined };
	}
	const row = deps.db.select().from(providerEvents).where(eq(providerEvents.id, event.id)).get();
	return { result: claimOutcomeForRow(row) };
}

export function claimEvent(
	deps: AppDeps,
	event: { id: string; provider: string; type: string },
): boolean {
	const nowIso = nowDate(deps).toISOString();
	const staleBefore = new Date(nowDate(deps).getTime() - CLAIM_STALE_MS).toISOString();
	const claimed = deps.db.run(sql`
		INSERT INTO provider_events (id, provider, type, status, claimed_at, received_at)
		VALUES (${event.id}, ${event.provider}, ${event.type}, 'processing', ${nowIso}, ${nowIso})
		ON CONFLICT(id) DO UPDATE SET claimed_at = ${nowIso}
		WHERE provider_events.status = 'processing'
			AND (provider_events.claimed_at IS NULL OR provider_events.claimed_at < ${staleBefore})
	`);
	return claimed.changes > 0;
}

/** Mark a claimed event fully processed (including its email). */
export function completeEvent(deps: AppDeps, eventId: string, claimToken?: string): void {
	// Fenced by the claim stamp: if a stale takeover happened, the original worker's
	// late completion must not mark the successor's work done.
	const where = claimToken
		? and(eq(providerEvents.id, eventId), eq(providerEvents.claimedAt, claimToken))
		: eq(providerEvents.id, eventId);
	deps.db.update(providerEvents).set({ status: 'done', claimedAt: null }).where(where).run();
}

/**
 * Give up a claim after a failed handler, so the provider's retry re-enters the
 * idempotent path rather than being deduped away with the work half-done.
 */
export function releaseEvent(deps: AppDeps, eventId: string, claimToken?: string): void {
	// Same fence: only the current claimant may hand the event back.
	const conditions = [eq(providerEvents.id, eventId), eq(providerEvents.status, 'processing')];
	if (claimToken) conditions.push(eq(providerEvents.claimedAt, claimToken));
	deps.db
		.delete(providerEvents)
		.where(and(...conditions))
		.run();
}

/** Set expires_at on the license tied to a subscription (renewal date advance). */
export function advanceSubscriptionExpiry(
	deps: AppDeps,
	subscriptionId: string,
	expiresAt: string,
	actor: string,
): void {
	const found = findLicenseByProviderId(deps, subscriptionId);
	if (!found || found.license.expiresAt === expiresAt) return;
	deps.db.update(licenses).set({ expiresAt }).where(eq(licenses.id, found.license.id)).run();
	writeAudit(deps.db, {
		action: 'license.expiry_advanced',
		actor,
		productId: found.license.productId,
		licenseId: found.license.id,
		detail: { from: found.license.expiresAt, to: expiresAt },
	});
}

/** Look up a purchase's license for the success-page endpoint. */
export function findByCheckoutId(
	deps: AppDeps,
	checkoutId: string,
): { license: License; product: Product; email: string } | undefined {
	const purchase = deps.db
		.select()
		.from(purchases)
		.where(and(eq(purchases.providerCheckoutId, checkoutId)))
		.get();
	if (!purchase) return undefined;
	const license = deps.db.select().from(licenses).where(eq(licenses.purchaseId, purchase.id)).get();
	if (!license) return undefined;
	const product = getProductById(deps.db, purchase.productId);
	if (!product) return undefined;
	return { license, product, email: purchase.email };
}
