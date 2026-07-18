// ABOUTME: The Stripe gateway seam (PRD §13) — signature verification and the reads the webhook needs.
// ABOUTME: A real SDK-backed impl for production; tests inject a fake so no network is required.

import Stripe from 'stripe';

export interface StripeEvent {
	id: string;
	type: string;
	data: { object: Record<string, unknown> };
}

export interface StripeGateway {
	/** Verify a raw webhook body against a signature + secret. Throws on failure. */
	constructEvent(rawBody: string, signature: string, secret: string): StripeEvent;
	/** current_period_end of a subscription as ISO 8601 (Basil: read from the first item). */
	subscriptionPeriodEnd(subscriptionId: string): Promise<string | null>;
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
	};
}
