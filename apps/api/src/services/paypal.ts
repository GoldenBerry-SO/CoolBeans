// ABOUTME: PayPal event handling (PRD §13) — a parallel adapter over the shared issuance core.
// ABOUTME: Issues only on completed captures; refund/cancel disable. Only the adapter differs.

import type { AppDeps } from '../deps.js';
import { getProductBySlug } from '../store/products.js';
import { disableLicense } from './lifecycle.js';
import {
	advanceSubscriptionExpiry,
	claimEvent,
	completeEvent,
	ensureLicense,
	findLicenseByProviderId,
	releaseEvent,
} from './payments.js';
import type { PayPalEvent } from './paypal-gateway.js';

function pickString(obj: Record<string, unknown>, path: string[]): string | null {
	let cur: unknown = obj;
	for (const key of path) {
		if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
			cur = (cur as Record<string, unknown>)[key];
		} else {
			return null;
		}
	}
	return typeof cur === 'string' ? cur : null;
}

/** Extract the capture id from a refund resource's "up" link (…/captures/<id>). */
function captureIdFromLinks(resource: Record<string, unknown>): string | null {
	const links = resource.links;
	if (!Array.isArray(links)) return null;
	for (const link of links) {
		if (link && typeof link === 'object') {
			const { rel, href } = link as { rel?: unknown; href?: unknown };
			if (rel === 'up' && typeof href === 'string') {
				const match = href.match(/\/captures\/([^/?#]+)/);
				if (match) return match[1] ?? null;
			}
		}
	}
	return null;
}

/** Try each candidate id in order against the purchase provider-id columns. */
function findLicenseByAnyId(deps: AppDeps, candidates: Array<string | null>) {
	for (const id of candidates) {
		if (!id) continue;
		const found = findLicenseByProviderId(deps, id);
		if (found) return found;
	}
	return undefined;
}

/**
 * Process a verified PayPal event. The claim is atomic, released on failure so the
 * provider's retry re-enters, and marked done only on full success (issue #34).
 */
export async function handlePayPalEvent(deps: AppDeps, event: PayPalEvent): Promise<void> {
	if (!claimEvent(deps, { id: event.id, provider: 'paypal', type: event.event_type })) return;
	try {
		await processPayPalEvent(deps, event);
	} catch (err) {
		releaseEvent(deps, event.id);
		throw err;
	}
	completeEvent(deps, event.id);
}

async function processPayPalEvent(deps: AppDeps, event: PayPalEvent): Promise<void> {
	const resource = event.resource;

	switch (event.event_type) {
		case 'PAYMENT.CAPTURE.COMPLETED': {
			// Order approval is NOT payment: only a COMPLETED capture issues a key.
			const captureStatus = pickString(resource, ['status']);
			if (captureStatus && captureStatus !== 'COMPLETED') break;
			// custom_id carries the product slug + tier set at checkout creation.
			const custom =
				pickString(resource, ['custom_id']) ??
				pickString(resource, ['purchase_units', '0', 'custom_id']);
			const [slug, tierRaw] = (custom ?? '').split(':');
			const product = slug ? getProductBySlug(deps.db, slug) : undefined;
			if (!product) {
				deps.logger.error('PayPal capture for unknown product', { custom, event: event.id });
				break;
			}
			const tier = tierRaw === 'yearly' ? 'yearly' : 'lifetime';
			const email =
				pickString(resource, ['payer', 'email_address']) ??
				pickString(resource, ['subscriber', 'email_address']) ??
				'';
			const captureId = pickString(resource, ['id']);
			// One canonical checkout id per ORDER so a redelivered/duplicate capture event
			// can never issue a second key; the capture itself is stored as the payment id.
			const orderId =
				pickString(resource, ['supplementary_data', 'related_ids', 'order_id']) ?? captureId;
			await ensureLicense(deps, {
				product,
				provider: 'paypal',
				checkoutId: orderId ?? event.id,
				tier,
				email,
				subscriptionId: pickString(resource, ['billing_agreement_id']),
				paymentId: captureId,
				amountTotal: parseAmount(resource),
				currency: pickString(resource, ['amount', 'currency_code']),
			});
			break;
		}

		case 'BILLING.SUBSCRIPTION.ACTIVATED': {
			const subId = pickString(resource, ['id']);
			const slug = (pickString(resource, ['custom_id']) ?? '').split(':')[0];
			const product = slug ? getProductBySlug(deps.db, slug) : undefined;
			if (!product || !subId) break;
			const email = pickString(resource, ['subscriber', 'email_address']) ?? '';
			let expiresAt: string | null = null;
			if (deps.paypal) expiresAt = await deps.paypal.subscriptionNextBilling(subId);
			await ensureLicense(deps, {
				product,
				provider: 'paypal',
				checkoutId: subId,
				tier: 'yearly',
				email,
				expiresAt,
				subscriptionId: subId,
			});
			break;
		}

		case 'PAYMENT.SALE.COMPLETED': {
			// Subscription renewals arrive as sales tied to the billing agreement:
			// advance the license's renewal date to the next billing time.
			const subId = pickString(resource, ['billing_agreement_id']);
			if (subId && deps.paypal) {
				const next = await deps.paypal.subscriptionNextBilling(subId);
				if (next) advanceSubscriptionExpiry(deps, subId, next, `paypal:${event.id}`);
			}
			break;
		}

		case 'PAYMENT.CAPTURE.REFUNDED': {
			// The refund resource's own id is the REFUND id; the capture we stored is in the
			// "up" link (…/v2/payments/captures/<capture_id>). Try that first, then fall back
			// to resource.id for older/alternate payload shapes.
			const found = findLicenseByAnyId(deps, [
				captureIdFromLinks(resource),
				pickString(resource, ['id']),
			]);
			if (found) {
				disableLicense(deps, {
					license: found.license,
					reason: 'refund',
					actor: `paypal:${event.id}`,
				});
			}
			break;
		}

		case 'BILLING.SUBSCRIPTION.CANCELLED':
		case 'BILLING.SUBSCRIPTION.SUSPENDED': {
			const subId = pickString(resource, ['id']);
			const found = subId && findLicenseByProviderId(deps, subId);
			if (found) {
				disableLicense(deps, {
					license: found.license,
					reason: 'subscription_canceled',
					actor: `paypal:${event.id}`,
				});
			}
			break;
		}

		default:
			break;
	}
}

/** Capture amount in minor units, when present (value is a decimal string like "49.00"). */
function parseAmount(resource: Record<string, unknown>): number | null {
	const value = pickString(resource, ['amount', 'value']);
	if (!value) return null;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/**
 * Issue from a PayPal order the success page just returned from, when the webhook
 * has not arrived yet (PRD §14: whichever channel lands first issues, the other reads).
 * Goes through the same idempotent ensureLicense path, so a later webhook is a no-op.
 * Only a captured order issues — an APPROVED-but-uncaptured order is not payment.
 */
export async function ensureLicenseForOrder(
	deps: AppDeps,
	order: Record<string, unknown>,
	actorEventId: string,
): Promise<boolean> {
	const orderId = pickString(order, ['id']);
	if (!orderId) return false;
	if (pickString(order, ['status']) !== 'COMPLETED') return false;

	const captureStatus = pickString(order, [
		'purchase_units',
		'0',
		'payments',
		'captures',
		'0',
		'status',
	]);
	if (captureStatus !== 'COMPLETED') return false;
	const captureId = pickString(order, ['purchase_units', '0', 'payments', 'captures', '0', 'id']);

	const custom =
		pickString(order, ['purchase_units', '0', 'custom_id']) ?? pickString(order, ['custom_id']);
	const [slug, tierRaw] = (custom ?? '').split(':');
	const product = slug ? getProductBySlug(deps.db, slug) : undefined;
	if (!product) {
		deps.logger.error('PayPal order resolves to no product', { custom, order: orderId });
		return false;
	}

	const email =
		pickString(order, ['payer', 'email_address']) ??
		pickString(order, ['purchase_units', '0', 'payee', 'email_address']) ??
		'';
	if (!email) return false;

	await ensureLicense(deps, {
		product,
		provider: 'paypal',
		checkoutId: orderId,
		tier: tierRaw === 'yearly' ? 'yearly' : 'lifetime',
		email,
		paymentId: captureId,
	});
	deps.logger.info('PayPal order issued via success-page lookup', {
		order: orderId,
		actor: actorEventId,
	});
	return true;
}
