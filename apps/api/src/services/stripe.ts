// ABOUTME: Stripe event handling (PRD §13) — the four events, with Basil/dispute/partial-refund care.
// ABOUTME: Idempotent two ways; event ids are recorded only on full success so email retries work.

import type { License, Product } from '@coolbeans/db';
import type { AppDeps } from '../deps.js';
import { writeAudit } from '../store/audit.js';
import { getProductBySlug, getProductByStripePrice } from '../store/products.js';
import { disableLicense } from './lifecycle.js';
import {
	advanceSubscriptionExpiry,
	claimEventStatus,
	completeEvent,
	ensureLicense,
	findLicenseByProviderId,
	releaseEvent,
} from './payments.js';
import type { StripeEvent } from './stripe-gateway.js';

function str(obj: Record<string, unknown>, key: string): string | null {
	const v = obj[key];
	return typeof v === 'string' ? v : null;
}
function num(obj: Record<string, unknown>, key: string): number | null {
	const v = obj[key];
	return typeof v === 'number' ? v : null;
}

/** A checkout session is only worth a key if Stripe says it was actually paid. */
function sessionIsPaid(obj: Record<string, unknown>): boolean {
	const status = str(obj, 'payment_status');
	return status === 'paid' || status === 'no_payment_required';
}

/**
 * Resolve the product for a checkout session and run the shared idempotent issuance.
 * Used by the webhook (checkout.session.completed / async_payment_succeeded) AND the
 * success-page ensure path (PRD §13/§14), so both channels behave identically.
 * Returns null when the session resolves to no configured product or is unpaid.
 */
export async function ensureLicenseForSession(
	deps: AppDeps,
	obj: Record<string, unknown>,
	actorEventId: string,
): Promise<{ license: License; product: Product } | null> {
	if (!sessionIsPaid(obj)) {
		// Async payment methods complete the session before the money settles; the
		// checkout.session.async_payment_succeeded event re-enters this path later.
		deps.logger.info('Stripe session not paid yet; skipping issuance', {
			session: str(obj, 'id'),
			payment_status: str(obj, 'payment_status'),
		});
		return null;
	}

	// Resolve the product from what was actually PAID (§13): the line-item price id
	// maps to exactly one product and tier, and it is set in Stripe rather than by
	// whoever opened the checkout session. metadata.product / client_reference_id is
	// only a fallback — trusting a label over the price lets a stale or mislabelled
	// landing page issue another product's key for this payment.
	const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};
	const slug =
		(typeof metadata.product === 'string' ? metadata.product : null) ??
		str(obj, 'client_reference_id');
	let product: Product | undefined;
	let priceTier: 'lifetime' | 'yearly' | null = null;
	if (deps.stripe) {
		const sessionId = str(obj, 'id');
		const priceIds = sessionId ? await deps.stripe.sessionPriceIds(sessionId) : [];
		for (const priceId of priceIds) {
			const match = getProductByStripePrice(deps.db, priceId);
			if (match) {
				product = match.product;
				priceTier = match.tier;
				break;
			}
		}
	}
	if (!product && slug) {
		product = getProductBySlug(deps.db, slug);
		if (product) {
			deps.logger.info('Stripe checkout resolved by metadata, no price matched', {
				slug,
				event: actorEventId,
			});
		}
	}
	if (!product) {
		deps.logger.error('Stripe checkout resolves to no product', {
			slug,
			event: actorEventId,
		});
		return null;
	}

	const mode = str(obj, 'mode');
	const tier = priceTier ?? (mode === 'subscription' ? 'yearly' : 'lifetime');
	const subscriptionId = str(obj, 'subscription');
	let expiresAt: string | null = null;
	if (tier === 'yearly' && subscriptionId && deps.stripe) {
		expiresAt = await deps.stripe.subscriptionPeriodEnd(subscriptionId);
	}
	const email =
		str(obj, 'customer_email') ??
		str((obj.customer_details as Record<string, unknown>) ?? {}, 'email') ??
		'';
	const result = await ensureLicense(deps, {
		product,
		provider: 'stripe',
		eventId: actorEventId,
		checkoutId: str(obj, 'id') ?? actorEventId,
		tier,
		email,
		expiresAt,
		customerId: str(obj, 'customer'),
		subscriptionId,
		paymentId: str(obj, 'payment_intent'),
		amountTotal: num(obj, 'amount_total'),
		currency: str(obj, 'currency'),
	});
	return { license: result.license, product };
}

/**
 * Process a verified Stripe event. Throws to force a 500 + provider retry (e.g. email failure);
 * the claim is released on failure so that retry re-enters the idempotent path, and marked
 * done only on full success. Claiming is atomic, so two concurrent redeliveries of the same
 * event cannot both run the handler (issue #34).
 */
export async function handleStripeEvent(deps: AppDeps, event: StripeEvent): Promise<void> {
	const claim = claimEventStatus(deps, { id: event.id, provider: 'stripe', type: event.type });
	// Already finished: acknowledge so the provider stops retrying.
	if (claim.result === 'done') return;
	// Someone else is mid-flight. Answering 200 would end the retries, and if that
	// worker died the issuance or refund would never happen — so fail retryably.
	if (claim.result === 'in_flight') {
		throw new Error(`Event ${event.id} is already being processed; retry shortly.`);
	}
	try {
		await processStripeEvent(deps, event);
	} catch (err) {
		releaseEvent(deps, event.id, claim.token);
		throw err;
	}
	completeEvent(deps, event.id, claim.token);
}

async function processStripeEvent(deps: AppDeps, event: StripeEvent): Promise<void> {
	const obj = event.data.object;

	switch (event.type) {
		case 'checkout.session.completed':
		case 'checkout.session.async_payment_succeeded': {
			await ensureLicenseForSession(deps, obj, event.id);
			break;
		}

		case 'charge.refunded': {
			// Only a FULL refund disables; partials are recorded but leave the license active.
			const refunded = num(obj, 'amount_refunded') ?? 0;
			const captured = num(obj, 'amount_captured') ?? num(obj, 'amount') ?? 0;
			const found = await findLicenseForCharge(deps, obj);
			if (found) {
				if (captured > 0 && refunded >= captured) {
					disableLicense(deps, {
						license: found.license,
						reason: 'refund',
						actor: `stripe:${event.id}`,
					});
				} else {
					writeAudit(deps.db, {
						action: 'license.partial_refund',
						actor: `stripe:${event.id}`,
						productId: found.license.productId,
						licenseId: found.license.id,
						detail: { refunded, captured },
					});
				}
			}
			break;
		}

		case 'customer.subscription.updated': {
			const subId = str(obj, 'id');
			const status = str(obj, 'status');
			if (!subId) break;
			// Dunning belt-and-braces: an unpaid subscription is a lapse.
			if (status === 'unpaid' || status === 'canceled') {
				const found = findLicenseByProviderId(deps, subId);
				if (found) {
					disableLicense(deps, {
						license: found.license,
						reason: 'subscription_canceled',
						actor: `stripe:${event.id}`,
					});
				}
			} else {
				const periodEnd = subscriptionPeriodEnd(obj);
				if (periodEnd) advanceSubscriptionExpiry(deps, subId, periodEnd, `stripe:${event.id}`);
			}
			break;
		}

		case 'customer.subscription.deleted': {
			// The yearly-lapse enforcement at end of the paid-through period.
			const subId = str(obj, 'id');
			if (!subId) break;
			const found = findLicenseByProviderId(deps, subId);
			if (found) {
				disableLicense(deps, {
					license: found.license,
					reason: 'subscription_canceled',
					actor: `stripe:${event.id}`,
				});
			}
			break;
		}

		case 'charge.dispute.created': {
			// A lost dispute never fires charge.refunded, so revoke on the dispute itself.
			const paymentIntent = str(obj, 'payment_intent');
			let found = paymentIntent ? findLicenseByProviderId(deps, paymentIntent) : undefined;
			if (!found) {
				// A renewal-invoice dispute carries a payment intent we never stored:
				// resolve charge -> invoice -> subscription via the gateway.
				const chargeId = str(obj, 'charge');
				const subId =
					chargeId && deps.stripe ? await deps.stripe.subscriptionForCharge(chargeId) : null;
				found = subId ? findLicenseByProviderId(deps, subId) : undefined;
			}
			if (found) {
				disableLicense(deps, {
					license: found.license,
					reason: 'chargeback',
					actor: `stripe:${event.id}`,
				});
			}
			break;
		}

		default:
			// Unhandled event types are acknowledged and recorded so Stripe stops retrying.
			break;
	}
}

/** Find the license behind a refunded charge: payment intent, then invoice -> subscription. */
async function findLicenseForCharge(deps: AppDeps, charge: Record<string, unknown>) {
	const paymentIntent = str(charge, 'payment_intent');
	if (paymentIntent) {
		const found = findLicenseByProviderId(deps, paymentIntent);
		if (found) return found;
	}
	// Renewal invoices carry a different payment intent than the checkout: resolve the
	// subscription. The invoice may be inline (expanded object) or a plain string id.
	let subId = resolveSubscriptionFromCharge(charge);
	if (!subId && typeof charge.invoice === 'string' && deps.stripe) {
		subId = await deps.stripe.invoiceSubscription(charge.invoice);
	}
	return subId ? findLicenseByProviderId(deps, subId) : undefined;
}

/** Read current_period_end off a subscription object (Basil: read from the first item). */
function subscriptionPeriodEnd(sub: Record<string, unknown>): string | null {
	const items = sub.items as { data?: Array<{ current_period_end?: number }> } | undefined;
	const end = items?.data?.[0]?.current_period_end;
	return end ? new Date(end * 1000).toISOString() : null;
}

/** Inline (expanded) subscription hints on a charge object, when the event carries them. */
function resolveSubscriptionFromCharge(charge: Record<string, unknown>): string | null {
	const sub = charge.subscription;
	if (typeof sub === 'string') return sub;
	const invoice = charge.invoice as Record<string, unknown> | string | undefined;
	if (invoice && typeof invoice === 'object') {
		if (typeof invoice.subscription === 'string') return invoice.subscription;
		const parent = invoice.parent as
			| { subscription_details?: { subscription?: unknown } }
			| undefined;
		const nested = parent?.subscription_details?.subscription;
		if (typeof nested === 'string') return nested;
	}
	return null;
}
