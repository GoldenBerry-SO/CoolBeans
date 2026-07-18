// ABOUTME: PayPal event handling (PRD §13) — a parallel adapter over the shared issuance core.
// ABOUTME: checkout completed -> ensureLicense; refund/cancel -> disable. Only the adapter differs.

import type { AppDeps } from '../deps.js';
import { getProductBySlug } from '../store/products.js';
import { disableLicense } from './lifecycle.js';
import {
	ensureLicense,
	eventAlreadyProcessed,
	findLicenseByProviderId,
	recordEvent,
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

/** Process a verified PayPal event; record it only on full success (retry-safe email). */
export async function handlePayPalEvent(deps: AppDeps, event: PayPalEvent): Promise<void> {
	if (eventAlreadyProcessed(deps, event.id)) return;
	const resource = event.resource;

	switch (event.event_type) {
		case 'PAYMENT.CAPTURE.COMPLETED':
		case 'CHECKOUT.ORDER.APPROVED': {
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
			await ensureLicense(deps, {
				product,
				provider: 'paypal',
				checkoutId: pickString(resource, ['id']) ?? event.id,
				tier,
				email,
				subscriptionId: pickString(resource, ['billing_agreement_id']),
				paymentId: pickString(resource, ['id']),
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

	recordEvent(deps, { id: event.id, provider: 'paypal', type: event.event_type });
}
