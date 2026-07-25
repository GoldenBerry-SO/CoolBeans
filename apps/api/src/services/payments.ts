// ABOUTME: Shared payment issuance + lookup helpers (PRD §13) — provider-agnostic core.
// ABOUTME: ensureLicense is idempotent on provider_checkout_id; email failures leave email_sent_at NULL.

import { randomUUID } from 'node:crypto';
import type { License, Product } from '@coolbeans/db';
import { applied, licenses, providerEvents, purchases } from '@coolbeans/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate, nowIso, withTx } from '../deps.js';
import { getAccountById } from '../store/accounts.js';
import { writeAudit } from '../store/audit.js';
import { isUniqueConstraintError } from '../store/db-errors.js';
import { findLicenseByProviderId } from '../store/payment-lookup.js';
import { getProductById } from '../store/products.js';
import { sendKeyEmail } from './email.js';
import { createPurchase, issueLicense, type Kind } from './issuance.js';
import { enqueue } from './outbox.js';
import { markOverLimit, planUsage, withinLimit } from './plan-limits.js';
import { applyPendingRevocation } from './reconcile.js';

export { findLicenseByProviderId } from '../store/payment-lookup.js';

/** Delay before the outbox backstop tries the key email, after inline send + provider retries. */
const EMAIL_BACKSTOP_DELAY_MS = 10 * 60_000;

export interface EnsureArgs {
	product: Product;
	provider: 'stripe' | 'paypal';
	checkoutId: string;
	kind: Kind;
	plan?: string | null;
	issuedGrantId?: number | null;
	activationLimit?: number | null;
	stripeConnectionId?: number | null;
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
		await writeAudit(deps.db, {
			action: 'license.issued_for_archived_product',
			actor: `${args.provider}:${args.eventId ?? args.checkoutId}`,
			accountId: args.product.accountId,
			productId: args.product.id,
			detail: { checkout: args.checkoutId, email: args.email },
		});
	}
	// Over the plan's licence cap. We issue anyway and never refuse here: a Free
	// customer's buyer has just paid *them*, so withholding the key breaks their business
	// to collect $99 from us. Record it instead — that is what the console banner and the
	// upgrade nudge hang off. Same shape as the archived-product case above.
	const account = await getAccountById(deps.db, args.product.accountId);
	if (account) {
		const licences = (await planUsage(deps, account)).activeLicenses;
		if (!withinLimit(licences)) {
			deps.logger.error('Licence issued past the plan limit; issuing anyway', {
				account: account.id,
				product: args.product.slug,
				checkout: args.checkoutId,
				current: licences.current,
				limit: licences.limit,
			});
			await writeAudit(deps.db, {
				action: 'account.license_limit_exceeded',
				actor: `${args.provider}:${args.eventId ?? args.checkoutId}`,
				accountId: account.id,
				productId: args.product.id,
				detail: { checkout: args.checkoutId, current: licences.current, limit: licences.limit },
			});
			await markOverLimit(deps, account.id, nowIso(deps));
		}
	}
	const { db } = deps;
	let created = false;

	const [existing] = await db
		.select()
		.from(licenses)
		.innerJoin(purchases, eq(purchases.id, licenses.purchaseId))
		.where(eq(purchases.providerCheckoutId, args.checkoutId))
		.limit(1);
	let license = existing?.licenses;

	if (!license) {
		try {
			// One transaction: a failure anywhere leaves no orphaned purchase behind, so a
			// provider retry re-enters this path cleanly instead of hitting a dead UNIQUE row.
			license = await db.transaction(async (tx): Promise<License> => {
				// Bind the bundle to the transaction: createPurchase, issueLicense and the
				// outbox enqueue must live or die together. A purchase that survives a failed
				// issuance is not merely untidy — provider_checkout_id is UNIQUE, so the
				// orphan permanently blocks the provider's retry and the customer who paid
				// can never be issued a key without manual surgery.
				const scoped = withTx(deps, tx);
				const purchase = await createPurchase(scoped, {
					productId: args.product.id,
					provider: args.provider,
					stripeConnectionId: args.stripeConnectionId ?? null,
					providerCheckoutId: args.checkoutId,
					providerCustomerId: args.customerId ?? null,
					providerSubscriptionId: args.subscriptionId ?? null,
					providerPaymentId: args.paymentId ?? null,
					email: args.email,
					amountTotal: args.amountTotal ?? null,
					currency: args.currency ?? null,
				});
				const issued = await issueLicense(scoped, {
					product: args.product,
					purchaseId: purchase.id,
					kind: args.kind,
					plan: args.plan,
					issuedGrantId: args.issuedGrantId,
					activationLimit: args.activationLimit,
					expiresAt: args.expiresAt,
					actor: `${args.provider}:${args.eventId ?? args.checkoutId}`,
				});
				// Durable backstop: if inline send and provider retries all fail, the worker sends later.
				await enqueue(
					scoped,
					'send_key_email',
					{ licenseId: issued.id, email: args.email },
					EMAIL_BACKSTOP_DELAY_MS,
				);
				return issued;
			});
			created = true;
		} catch (err) {
			// A concurrent insert won the checkout-id UNIQUE race; re-read the winner's license.
			if (
				isUniqueConstraintError(err, [
					'purchases.provider_checkout_id',
					'purchases_provider_checkout_id_unique',
				])
			) {
				const [winner] = await db
					.select()
					.from(licenses)
					.innerJoin(purchases, eq(purchases.id, licenses.purchaseId))
					.where(eq(purchases.providerCheckoutId, args.checkoutId))
					.limit(1);
				license = winner?.licenses;
			}
			if (!license) throw err;
		}
	}

	// Terminal events can arrive before checkout issuance. Reconcile before either the
	// inline email or its durable outbox backstop can expose a key that is already revoked.
	license = await applyPendingRevocation(deps, {
		license,
		provider: args.provider,
		references: [args.paymentId, args.subscriptionId, args.checkoutId],
	});

	// Retry-only-email path: send if not yet sent. A failure propagates (caller returns 500).
	if (license.status === 'active' && !license.emailSentAt && deps.email) {
		await sendKeyEmail(deps, { license, product: args.product, email: args.email });
	}

	return { license, created };
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

/**
 * An event, plus the account it belongs to when the caller already knows.
 *
 * The per-product webhook URL names its product, so the owning account is known before
 * anything is parsed. The global Stripe and PayPal webhooks do not, and leave it null —
 * those rows are instance-level and only an instance token sees them.
 */
export interface ClaimableEvent {
	id: string;
	provider: string;
	type: string;
	accountId?: number;
}

export async function claimEventStatus(deps: AppDeps, event: ClaimableEvent): Promise<Claim> {
	const nowIso = nowDate(deps).toISOString();
	const staleBefore = new Date(nowDate(deps).getTime() - CLAIM_STALE_MS).toISOString();
	const accountId = event.accountId ?? null;
	// The fence comes back from the claim statement itself. The old shape claimed and then
	// re-SELECTed the stamp, and a stale takeover in that gap handed the elder claimant
	// the successor's fence — its late completion would then mark the successor's work
	// done while the provider stopped retrying (the exact failure issue #34 fixed).
	const token = randomUUID();
	const claimed = await deps.db.execute(sql`
		INSERT INTO provider_events (id, account_id, provider, type, status, claimed_at, claim_token, received_at)
		VALUES (${event.id}, ${accountId}, ${event.provider}, ${event.type}, 'processing', ${nowIso}, ${token}, ${nowIso})
		ON CONFLICT(id) DO UPDATE SET
			claimed_at = ${nowIso},
			claim_token = ${token},
			-- Never blank an attribution we already have: a stale-claim takeover of a row
			-- first seen on the per-product URL must keep its account.
			account_id = COALESCE(provider_events.account_id, ${accountId})
		WHERE provider_events.status = 'processing'
			AND (provider_events.claimed_at IS NULL OR provider_events.claimed_at < ${staleBefore})
		RETURNING claim_token
	`);
	if (applied(claimed)) return { result: 'claimed', token };
	const [row] = await deps.db
		.select()
		.from(providerEvents)
		.where(eq(providerEvents.id, event.id))
		.limit(1);
	return { result: claimOutcomeForRow(row) };
}

/** Boolean shorthand over claimEventStatus, for callers that only gate on "may I run". */
export async function claimEvent(deps: AppDeps, event: ClaimableEvent): Promise<boolean> {
	return (await claimEventStatus(deps, event)).result === 'claimed';
}

/**
 * Attribute an already-claimed event to an account, for handlers that only learn the
 * account by parsing the payload (platform billing reads it from Stripe metadata).
 * Never overwrites an attribution already made at claim time.
 */
export async function attributeEvent(
	deps: AppDeps,
	eventId: string,
	accountId: number,
): Promise<void> {
	await deps.db
		.update(providerEvents)
		.set({ accountId })
		.where(and(eq(providerEvents.id, eventId), isNull(providerEvents.accountId)));
}

/** Mark a claimed event fully processed (including its email). */
export async function completeEvent(
	deps: AppDeps,
	eventId: string,
	claimToken?: string,
): Promise<void> {
	// Fenced by the claim stamp: if a stale takeover happened, the original worker's
	// late completion must not mark the successor's work done.
	const where = claimToken
		? and(eq(providerEvents.id, eventId), eq(providerEvents.claimToken, claimToken))
		: eq(providerEvents.id, eventId);
	await deps.db
		.update(providerEvents)
		.set({ status: 'done', claimedAt: null, claimToken: null })
		.where(where);
}

/**
 * Give up a claim after a failed handler, so the provider's retry re-enters the
 * idempotent path rather than being deduped away with the work half-done.
 */
export async function releaseEvent(
	deps: AppDeps,
	eventId: string,
	claimToken?: string,
): Promise<void> {
	// Same fence: only the current claimant may hand the event back.
	const conditions = [eq(providerEvents.id, eventId), eq(providerEvents.status, 'processing')];
	if (claimToken) conditions.push(eq(providerEvents.claimToken, claimToken));
	await deps.db.delete(providerEvents).where(and(...conditions));
}

/** Set expires_at on the license tied to a subscription (renewal date advance). */
export async function advanceSubscriptionExpiry(
	deps: AppDeps,
	subscriptionId: string,
	expiresAt: string,
	actor: string,
): Promise<void> {
	const found = await findLicenseByProviderId(deps, subscriptionId);
	if (!found || found.license.expiresAt === expiresAt) return;
	await deps.db.update(licenses).set({ expiresAt }).where(eq(licenses.id, found.license.id));
	await writeAudit(deps.db, {
		action: 'license.expiry_advanced',
		actor,
		productId: found.license.productId,
		licenseId: found.license.id,
		detail: { from: found.license.expiresAt, to: expiresAt },
	});
}

/** Look up a purchase's license for the success-page endpoint. */
export async function findByCheckoutId(
	deps: AppDeps,
	checkoutId: string,
): Promise<{ license: License; product: Product; email: string } | undefined> {
	const [purchase] = await deps.db
		.select()
		.from(purchases)
		.where(and(eq(purchases.providerCheckoutId, checkoutId)))
		.limit(1);
	if (!purchase) return undefined;
	const [license] = await deps.db
		.select()
		.from(licenses)
		.where(eq(licenses.purchaseId, purchase.id))
		.limit(1);
	if (!license) return undefined;
	const product = await getProductById(deps.db, purchase.productId);
	if (!product) return undefined;
	return { license, product, email: purchase.email };
}
