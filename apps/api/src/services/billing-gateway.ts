// ABOUTME: The Stripe seam for OUR subscription business — customers paying for hosted Cool Beans.
// ABOUTME: Deliberately separate from StripeGateway: different key, different account, different secret.

import Stripe from 'stripe';
import type { StripeEvent } from './stripe-gateway.js';

export type { StripeEvent };

export interface CheckoutArgs {
	customerId: string;
	priceId: string;
	successUrl: string;
	cancelUrl: string;
	/**
	 * Stamped onto both the session and the subscription it creates, so every later
	 * lifecycle event carries the account it belongs to rather than depending on an
	 * earlier write having landed.
	 */
	accountId: number;
}

export interface BillingSubscription {
	id: string;
	status: string;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	priceId: string | null;
}

/**
 * Kept apart from StripeGateway rather than folded into it, for three reasons that all
 * bite in production:
 *
 *  - They are built from different secret keys. One object would force one key, which is
 *    exactly the mix-up the separate BILLING_ namespace exists to prevent.
 *  - StripeGateway's surface is licence-issuance shaped, so merging would make every
 *    fakeStripeGateway in the suite grow methods it never calls.
 *  - Type-level separation makes it impossible to reach a billing method by accident from
 *    services/stripe.ts, where the money belongs to somebody else.
 */
export interface BillingGateway {
	/** Create (or reuse) the Stripe customer that represents one Cool Beans account. */
	createCustomer(args: { email: string; accountId: number; name?: string }): Promise<string>;
	/** A Checkout Session URL for the Pro subscription. */
	createCheckoutSession(args: CheckoutArgs): Promise<string>;
	/** A billing-portal URL so a subscriber can manage or cancel without us. */
	billingPortalSession(customerId: string, returnUrl: string): Promise<string>;
	/** Verify a raw webhook body against a signature + secret. Throws on failure. */
	constructEvent(rawBody: string, signature: string, secret: string): StripeEvent;
	/** Read a subscription's current state, for reconciling after an out-of-order event. */
	getSubscription(subscriptionId: string): Promise<BillingSubscription | null>;
}

function hostOf(base: string): string {
	return new URL(base).hostname;
}
function portOf(base: string): number {
	const url = new URL(base);
	return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
}
function protocolOf(base: string): 'http' | 'https' {
	return new URL(base).protocol === 'https:' ? 'https' : 'http';
}

/** The account id we stamp on Stripe objects, matching the coolbeans_slug convention. */
export const ACCOUNT_METADATA_KEY = 'coolbeans_account_id';

/**
 * The Goldenberry-wide app stamp. One Stripe account carries billing for several
 * products, and Stripe fans every subscribed event out to every webhook endpoint on the
 * account — so every consumer needs a cheap way to say "not mine" before touching its
 * own tables. Every app stamps `gb_app: <its slug>` on the customers, sessions and
 * subscriptions it creates; every webhook bounces events stamped for someone else.
 * Namespaced `gb_` so it can never collide with a project's own metadata keys.
 */
export const APP_METADATA_KEY = 'gb_app';
export const APP_METADATA_VALUE = 'coolbeans';

export function createBillingGateway(secretKey: string, apiBase?: string): BillingGateway {
	// apiBase points the SDK at scripts/journey/stripe-mock.mjs; unset in production.
	const stripe = new Stripe(
		secretKey,
		apiBase
			? { host: hostOf(apiBase), port: portOf(apiBase), protocol: protocolOf(apiBase) }
			: undefined,
	);
	return {
		async createCustomer({ email, accountId, name }) {
			const customer = await stripe.customers.create({
				email,
				...(name ? { name } : {}),
				metadata: {
					[APP_METADATA_KEY]: APP_METADATA_VALUE,
					[ACCOUNT_METADATA_KEY]: String(accountId),
				},
			});
			return customer.id;
		},
		async createCheckoutSession({ customerId, priceId, successUrl, cancelUrl, accountId }) {
			const session = await stripe.checkout.sessions.create({
				mode: 'subscription',
				customer: customerId,
				line_items: [{ price: priceId, quantity: 1 }],
				success_url: successUrl,
				cancel_url: cancelUrl,
				// Coupons enter here: comped accounts and discounts go through the same real
				// checkout and the same webhook, never through hand-edited billing state.
				allow_promotion_codes: true,
				metadata: {
					[APP_METADATA_KEY]: APP_METADATA_VALUE,
					[ACCOUNT_METADATA_KEY]: String(accountId),
				},
				// On the subscription too, so customer.subscription.* events identify their
				// account without us having to have recorded the id first.
				subscription_data: {
					metadata: {
						[APP_METADATA_KEY]: APP_METADATA_VALUE,
						[ACCOUNT_METADATA_KEY]: String(accountId),
					},
				},
			});
			if (!session.url) throw new Error('Stripe returned a checkout session with no URL');
			return session.url;
		},
		async billingPortalSession(customerId, returnUrl) {
			const session = await stripe.billingPortal.sessions.create({
				customer: customerId,
				return_url: returnUrl,
			});
			return session.url;
		},
		constructEvent(rawBody, signature, secret) {
			return stripe.webhooks.constructEvent(rawBody, signature, secret) as unknown as StripeEvent;
		},
		async getSubscription(subscriptionId) {
			const sub = await stripe.subscriptions.retrieve(subscriptionId);
			if (!sub) return null;
			// Basil (2025-03-31) moved current_period_end onto subscription items.
			const item = sub.items?.data?.[0] as
				| { current_period_end?: number; price?: { id?: string } }
				| undefined;
			return {
				id: sub.id,
				status: sub.status,
				currentPeriodEnd: item?.current_period_end
					? new Date(item.current_period_end * 1000).toISOString()
					: null,
				cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
				priceId: item?.price?.id ?? null,
			};
		},
	};
}
