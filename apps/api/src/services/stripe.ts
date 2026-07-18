// ABOUTME: Stripe event handling (PRD §13) — the four events, with Basil/dispute/partial-refund care.
// ABOUTME: Idempotent two ways; event ids are recorded only on full success so email retries work.

import type { License, Product } from '@coolbeans/db';
import type { AppDeps } from '../deps.js';
import { writeAudit } from '../store/audit.js';
import { getProductBySlug, getProductByStripePrice } from '../store/products.js';
import {
	lastSubscriptionEventAt,
	markSubscriptionEventApplied,
	shouldApplySubscriptionEvent,
} from './event-order.js';
import { disableLicense, restoreLicense } from './lifecycle.js';
import {
	advanceSubscriptionExpiry,
	claimEventStatus,
	completeEvent,
	ensureLicense,
	findLicenseByProviderId,
	releaseEvent,
} from './payments.js';
import {
	applyPendingRevocation,
	dropPendingRevocation,
	recordPendingRevocation,
} from './reconcile.js';
import type { StripeEvent } from './stripe-gateway.js';

/**
 * Subscription statuses that mean access should stop. 'past_due' is deliberately absent:
 * Stripe is still retrying the card, and cutting a customer off mid-dunning is the
 * lockout §9 exists to prevent. 'unpaid' is where dunning gives up.
 */
const LAPSED_SUBSCRIPTION_STATUSES = new Set(['unpaid', 'canceled', 'incomplete_expired']);

/**
 * Statuses that mean they are actually paying, and the only ones that restore access.
 * Everything else (past_due, paused, incomplete) leaves the licence exactly as it is.
 */
const PAYING_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

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
	let paidQuantity = 1;
	if (deps.stripe) {
		const sessionId = str(obj, 'id');
		const lineItems = sessionId ? await deps.stripe.sessionLineItems(sessionId) : [];
		for (const item of lineItems) {
			const match = getProductByStripePrice(deps.db, item.priceId);
			if (match) {
				product = match.product;
				priceTier = match.tier;
				paidQuantity = item.quantity;
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
		// We answer 200 so Stripe stops retrying (a retry cannot fix a price id that
		// points nowhere), which means a log line is the only trace unless we write one.
		// Someone paid: record it so the money can be reconciled against a real person.
		writeAudit(deps.db, {
			action: 'payment.unfulfilled',
			actor: `stripe:${actorEventId}`,
			detail: {
				reason: 'no_product_for_checkout',
				checkout_id: str(obj, 'id'),
				email: str(obj, 'customer_email'),
				amount_total: num(obj, 'amount_total'),
				currency: str(obj, 'currency'),
				slug,
			},
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
	// One checkout issues exactly one key. If they were charged for more, we cannot
	// un-charge them here, but a silent mismatch means nobody ever finds out.
	if (paidQuantity > 1) {
		writeAudit(deps.db, {
			action: 'payment.quantity_mismatch',
			actor: `stripe:${actorEventId}`,
			productId: product.id,
			licenseId: result.license.id,
			detail: {
				quantity: paidQuantity,
				issued: 1,
				checkout_id: str(obj, 'id'),
				email,
			},
		});
	}

	// A refund or dispute for this payment may have arrived before the checkout did.
	const license = applyPendingRevocation(deps, {
		license: result.license,
		provider: 'stripe',
		references: [str(obj, 'payment_intent'), subscriptionId],
	});
	return { license, product };
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
			const isFull = captured > 0 && refunded >= captured;
			if (!found) {
				// The checkout has not landed yet. Remember it so issuance revokes on
				// arrival instead of handing out a key for refunded money.
				//
				// Park under EVERY id the checkout might carry. A renewal refund names an
				// invoice payment intent the checkout session never mentions, so parking
				// under that alone would strand the revocation forever.
				if (isFull) {
					const subFromCharge = await subscriptionForCharge(deps, obj);
					for (const reference of [str(obj, 'payment_intent'), subFromCharge]) {
						if (!reference) continue;
						recordPendingRevocation(deps, {
							provider: 'stripe',
							reference,
							reason: 'refund',
							eventId: event.id,
						});
					}
				}
				break;
			}
			if (isFull) {
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
			break;
		}

		case 'customer.subscription.updated': {
			const subId = str(obj, 'id');
			const status = str(obj, 'status');
			if (!subId) break;
			// Stripe retries for days, so this may be an older state than the one we have
			// already acted on. Applying it would resurrect a cancelled licence.
			if (!shouldApplySubscriptionEvent(event.created, lastSubscriptionEventAt(deps, subId))) {
				deps.logger.info('Ignoring a stale subscription event', {
					event: event.id,
					subscription: subId,
					status,
				});
				break;
			}
			markSubscriptionEventApplied(deps, subId, event.created);
			const found = findLicenseByProviderId(deps, subId);

			// Dunning belt-and-braces: an unpaid or dead subscription is a lapse.
			if (LAPSED_SUBSCRIPTION_STATUSES.has(status ?? '')) {
				if (found) {
					disableLicense(deps, {
						license: found.license,
						reason: 'subscription_canceled',
						actor: `stripe:${event.id}`,
					});
				} else {
					recordPendingRevocation(deps, {
						provider: 'stripe',
						reference: subId,
						reason: 'subscription_canceled',
						eventId: event.id,
					});
				}
				break;
			}

			// Only an explicitly healthy status gives access back. past_due means they
			// still have not paid, and treating every other status as recovery would let
			// a stale 'active' delivered after a cancellation resurrect a dead licence.
			if (PAYING_SUBSCRIPTION_STATUSES.has(status ?? '')) {
				if (found) {
					restoreLicense(deps, {
						license: found.license,
						trigger: 'subscription_recovered',
						actor: `stripe:${event.id}`,
					});
				} else {
					// They lapsed and paid up, both before the checkout landed. The parked
					// lapse would otherwise fire the moment the licence is created and lock
					// out someone who is paying.
					dropPendingRevocation(deps, {
						provider: 'stripe',
						reference: subId,
						reason: 'subscription_canceled',
					});
				}
			}
			const periodEnd = subscriptionPeriodEnd(obj);
			if (periodEnd) advanceSubscriptionExpiry(deps, subId, periodEnd, `stripe:${event.id}`);
			break;
		}

		case 'customer.subscription.deleted': {
			// The yearly-lapse enforcement at end of the paid-through period.
			const subId = str(obj, 'id');
			if (!subId) break;
			if (!shouldApplySubscriptionEvent(event.created, lastSubscriptionEventAt(deps, subId))) {
				deps.logger.info('Ignoring a stale subscription deletion', {
					event: event.id,
					subscription: subId,
				});
				break;
			}
			markSubscriptionEventApplied(deps, subId, event.created);
			const found = findLicenseByProviderId(deps, subId);
			if (found) {
				disableLicense(deps, {
					license: found.license,
					reason: 'subscription_canceled',
					actor: `stripe:${event.id}`,
				});
			} else {
				// The checkout has not landed yet. Without parking this, the licence it
				// issues would be active for a subscription that is already gone.
				recordPendingRevocation(deps, {
					provider: 'stripe',
					reference: subId,
					reason: 'subscription_canceled',
					eventId: event.id,
				});
			}
			break;
		}

		case 'charge.dispute.created': {
			// A lost dispute never fires charge.refunded, so revoke on the dispute itself.
			const found = await findLicenseForDispute(deps, obj);
			if (found) {
				disableLicense(deps, {
					license: found.license,
					reason: 'chargeback',
					actor: `stripe:${event.id}`,
				});
			} else {
				// Same out-of-order problem as a refund: revoke on arrival.
				const reference = str(obj, 'payment_intent');
				if (reference) {
					recordPendingRevocation(deps, {
						provider: 'stripe',
						reference,
						reason: 'chargeback',
						eventId: event.id,
					});
				}
			}
			break;
		}

		case 'charge.dispute.closed': {
			// 'won' means the bank sided with us and we keep the money, so the customer
			// paid after all and must get their access back. 'lost' stays revoked.
			if (str(obj, 'status') !== 'won') break;

			// Always drop a parked chargeback, licence or no licence. Issuance commits the
			// licence before it sends the key email, so a won event can arrive while the
			// row is active and unconsumed; restoring alone would no-op on an active
			// licence and leave the parked cause to disable a paying customer afterwards.
			const reference = str(obj, 'payment_intent');
			if (reference) {
				dropPendingRevocation(deps, {
					provider: 'stripe',
					reference,
					reason: 'chargeback',
				});
			}

			const found = await findLicenseForDispute(deps, obj);
			if (found) {
				restoreLicense(deps, {
					license: found.license,
					trigger: 'dispute_won',
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

/**
 * Find the license a dispute refers to. A renewal-invoice dispute carries a payment intent
 * we never stored, so fall back to charge -> invoice -> subscription via the gateway.
 */
async function findLicenseForDispute(deps: AppDeps, dispute: Record<string, unknown>) {
	const paymentIntent = str(dispute, 'payment_intent');
	const direct = paymentIntent ? findLicenseByProviderId(deps, paymentIntent) : undefined;
	if (direct) return direct;
	const chargeId = str(dispute, 'charge');
	const subId = chargeId && deps.stripe ? await deps.stripe.subscriptionForCharge(chargeId) : null;
	return subId ? findLicenseByProviderId(deps, subId) : undefined;
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

/**
 * The subscription behind a charge: inline hints first, then the gateway (charge ->
 * invoice -> subscription). Used when parking a revocation so it is filed under an id
 * the checkout session will actually present.
 */
async function subscriptionForCharge(
	deps: AppDeps,
	charge: Record<string, unknown>,
): Promise<string | null> {
	const inline = resolveSubscriptionFromCharge(charge);
	if (inline) return inline;
	if (!deps.stripe) return null;
	// Best effort only. A one-time charge has no invoice to look up, and the lookup can
	// fail outright; neither is a reason to fail the webhook and have Stripe retry a
	// refund forever. Park under the ids we do have instead.
	try {
		const chargeId = str(charge, 'id');
		if (chargeId) {
			const viaCharge = await deps.stripe.subscriptionForCharge(chargeId);
			if (viaCharge) return viaCharge;
		}
		if (typeof charge.invoice === 'string') {
			return await deps.stripe.invoiceSubscription(charge.invoice);
		}
	} catch (err) {
		deps.logger.info('Could not resolve a subscription for this charge', {
			charge: str(charge, 'id'),
			message: (err as Error).message,
		});
	}
	return null;
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
