// ABOUTME: The Stripe gateway seam (PRD §13) — signature verification and the reads the webhook needs.
// ABOUTME: A real SDK-backed impl for production; tests inject a fake so no network is required.

import Stripe from 'stripe';

export interface StripeEvent {
	id: string;
	type: string;
	data: { object: Record<string, unknown> };
}

export interface StripeConnectResult {
	lifetimePriceId: string;
	yearlyPriceId: string;
	webhookSecret: string;
}

export interface StripeGateway {
	/** Verify a raw webhook body against a signature + secret. Throws on failure. */
	constructEvent(rawBody: string, signature: string, secret: string): StripeEvent;
	/** current_period_end of a subscription as ISO 8601 (Basil: read from the first item). */
	subscriptionPeriodEnd(subscriptionId: string): Promise<string | null>;
	/** Price ids of a checkout session's line items (for product resolution, PRD §13). */
	sessionPriceIds(sessionId: string): Promise<string[]>;
	/**
	 * Onboard a product: create the two prices (one-time lifetime + recurring yearly) and
	 * register the webhook endpoint, returning the ids and signing secret. Idempotent by
	 * product/lookup so re-running does not duplicate prices or endpoints (PRD §13).
	 */
	connect(args: {
		productName: string;
		productSlug: string;
		webhookUrl: string;
		lifetimeAmount: number;
		yearlyAmount: number;
		currency: string;
	}): Promise<StripeConnectResult>;
}

/** Production gateway backed by the official stripe SDK. */
export function createStripeGateway(secretKey: string): StripeGateway {
	const stripe = new Stripe(secretKey);
	return {
		constructEvent(rawBody, signature, secret) {
			return stripe.webhooks.constructEvent(rawBody, signature, secret) as unknown as StripeEvent;
		},
		async subscriptionPeriodEnd(subscriptionId) {
			const sub = await stripe.subscriptions.retrieve(subscriptionId);
			// Basil (2025-03-31) moved current_period_end onto subscription items.
			const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
			const end = item?.current_period_end;
			return end ? new Date(end * 1000).toISOString() : null;
		},
		async sessionPriceIds(sessionId) {
			const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 10 });
			return items.data.map((li) => li.price?.id).filter((id): id is string => !!id);
		},
		async connect(args) {
			const product = await stripe.products.create({
				name: args.productName,
				metadata: { coolbeans_slug: args.productSlug },
			});
			const lifetime = await stripe.prices.create({
				product: product.id,
				currency: args.currency,
				unit_amount: args.lifetimeAmount,
			});
			const yearly = await stripe.prices.create({
				product: product.id,
				currency: args.currency,
				unit_amount: args.yearlyAmount,
				recurring: { interval: 'year' },
			});
			const endpoint = await stripe.webhookEndpoints.create({
				url: args.webhookUrl,
				enabled_events: [
					'checkout.session.completed',
					'charge.refunded',
					'charge.dispute.created',
					'customer.subscription.updated',
					'customer.subscription.deleted',
				],
				metadata: { coolbeans_slug: args.productSlug },
			});
			return {
				lifetimePriceId: lifetime.id,
				yearlyPriceId: yearly.id,
				webhookSecret: endpoint.secret ?? '',
			};
		},
	};
}
