// ABOUTME: Shared payment issuance + lookup helpers (PRD §13) — provider-agnostic core.
// ABOUTME: ensureLicense is idempotent on provider_checkout_id; email failures leave email_sent_at NULL.

import type { License, Product } from '@coolbeans/db';
import { licenses, providerEvents, purchases } from '@coolbeans/db';
import { and, eq, or } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { getProductById } from '../store/products.js';
import { sendKeyEmail } from './email.js';
import { createPurchase, issueLicense, type Tier } from './issuance.js';

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
			license = issueLicense(deps, {
				product: args.product,
				purchaseId: purchase.id,
				tier: args.tier,
				expiresAt: args.expiresAt,
				actor: `${args.provider}:${args.checkoutId}`,
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

/** True if a provider event id was already fully processed (recorded only on success). */
export function eventAlreadyProcessed(deps: AppDeps, eventId: string): boolean {
	return !!deps.db.select().from(providerEvents).where(eq(providerEvents.id, eventId)).get();
}

/** Record a provider event as processed. Call only after full success (incl. email). */
export function recordEvent(
	deps: AppDeps,
	event: { id: string; provider: string; type: string },
): void {
	deps.db
		.insert(providerEvents)
		.values({ id: event.id, provider: event.provider, type: event.type })
		.onConflictDoNothing()
		.run();
}

/** Set expires_at on the license tied to a subscription (renewal date advance). */
export function advanceSubscriptionExpiry(
	deps: AppDeps,
	subscriptionId: string,
	expiresAt: string,
): void {
	const found = findLicenseByProviderId(deps, subscriptionId);
	if (!found) return;
	deps.db.update(licenses).set({ expiresAt }).where(eq(licenses.id, found.license.id)).run();
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
