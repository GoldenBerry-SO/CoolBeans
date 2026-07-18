// ABOUTME: Stripe event handling (PRD §13) — the four events, with Basil/dispute/partial-refund care.
// ABOUTME: Idempotent two ways; event ids are recorded only on full success so email retries work.

import type { AppDeps } from '../deps.js';
import { getProductBySlug, getProductByStripePrice } from '../store/products.js';
import { disableLicense } from './lifecycle.js';
import {
	advanceSubscriptionExpiry,
	ensureLicense,
	eventAlreadyProcessed,
	findLicenseByProviderId,
	recordEvent,
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

/**
 * Process a verified Stripe event. Throws to force a 500 + provider retry (e.g. email failure);
 * records the event id only on full success so a retry re-enters the idempotent path.
 */
export async function handleStripeEvent(deps: AppDeps, event: StripeEvent): Promise<void> {
	if (eventAlreadyProcessed(deps, event.id)) return;
	const obj = event.data.object;

	switch (event.type) {
		case 'checkout.session.completed': {
			// Resolve the product: metadata.product / client_reference_id first, then the
			// session's line-item price id against the product price columns (PRD §13).
			const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};
			const slug =
				(typeof metadata.product === 'string' ? metadata.product : null) ??
				str(obj, 'client_reference_id');
			let product = slug ? getProductBySlug(deps.db, slug) : undefined;
			let priceTier: 'lifetime' | 'yearly' | null = null;
			if (!product && deps.stripe) {
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
			if (!product) {
				deps.logger.error('Stripe checkout resolves to no product', { slug, event: event.id });
				break;
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
			await ensureLicense(deps, {
				product,
				provider: 'stripe',
				checkoutId: str(obj, 'id') ?? event.id,
				tier,
				email,
				expiresAt,
				customerId: str(obj, 'customer'),
				subscriptionId,
				paymentId: str(obj, 'payment_intent'),
				amountTotal: num(obj, 'amount_total'),
				currency: str(obj, 'currency'),
			});
			break;
		}

		case 'charge.refunded': {
			// Only a FULL refund disables; partials are recorded but leave the license active.
			const refunded = num(obj, 'amount_refunded') ?? 0;
			const captured = num(obj, 'amount_captured') ?? num(obj, 'amount') ?? 0;
			const paymentIntent = str(obj, 'payment_intent');
			const invoiceSub = resolveSubscriptionFromCharge(obj);
			const found =
				(paymentIntent && findLicenseByProviderId(deps, paymentIntent)) ||
				(invoiceSub && findLicenseByProviderId(deps, invoiceSub));
			if (found) {
				if (captured > 0 && refunded >= captured) {
					disableLicense(deps, {
						license: found.license,
						reason: 'refund',
						actor: `stripe:${event.id}`,
					});
				} else {
					deps.logger.info('Partial refund recorded, license kept active', {
						event: event.id,
						licenseId: found.license.id,
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
				if (periodEnd) advanceSubscriptionExpiry(deps, subId, periodEnd);
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
			const charge = str(obj, 'charge');
			const found =
				(paymentIntent && findLicenseByProviderId(deps, paymentIntent)) ||
				(charge && findLicenseByProviderId(deps, charge));
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

	recordEvent(deps, { id: event.id, provider: 'stripe', type: event.type });
}

/** Read current_period_end off a subscription object (Basil: read from the first item). */
function subscriptionPeriodEnd(sub: Record<string, unknown>): string | null {
	const items = sub.items as { data?: Array<{ current_period_end?: number }> } | undefined;
	const end = items?.data?.[0]?.current_period_end;
	return end ? new Date(end * 1000).toISOString() : null;
}

/** A refunded renewal invoice carries a different payment_intent — resolve via its subscription. */
function resolveSubscriptionFromCharge(charge: Record<string, unknown>): string | null {
	const sub = charge.subscription;
	if (typeof sub === 'string') return sub;
	const invoice = charge.invoice as Record<string, unknown> | string | undefined;
	if (invoice && typeof invoice === 'object' && typeof invoice.subscription === 'string') {
		return invoice.subscription;
	}
	return null;
}
