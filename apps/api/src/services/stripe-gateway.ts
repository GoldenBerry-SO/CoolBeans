// ABOUTME: The Stripe gateway seam (PRD §13) — signature verification and the reads the webhook needs.
// ABOUTME: A real SDK-backed impl for production; tests inject a fake so no network is required.

import Stripe from 'stripe';

export interface StripeEvent {
	id: string;
	type: string;
	/** Unix seconds. Used to ignore a stale subscription event Stripe redelivered late. */
	created?: number;
	data: { object: Record<string, unknown> };
}

export interface StripeConnectResult {
	lifetimePriceId: string;
	yearlyPriceId: string;
	webhookSecret: string;
}

export interface SessionLineItem {
	priceId: string;
	quantity: number;
}

export interface StripeGateway {
	/** A Stripe billing-portal URL for a customer, so a subscriber can self-manage (§15). */
	billingPortalSession(customerId: string, returnUrl: string): Promise<string>;
	/** Verify a raw webhook body against a signature + secret. Throws on failure. */
	constructEvent(rawBody: string, signature: string, secret: string): StripeEvent;
	/** current_period_end of a subscription as ISO 8601 (Basil: read from the first item). */
	subscriptionPeriodEnd(subscriptionId: string): Promise<string | null>;
	/** Price ids of a checkout session's line items (for product resolution, PRD §13). */
	/**
	 * The paid line items. Quantity is carried, not dropped: a checkout that charged for
	 * three still yields exactly one key, and that gap has to be visible.
	 */
	sessionLineItems(sessionId: string): Promise<SessionLineItem[]>;
	/** The subscription id an invoice belongs to (Basil: parent.subscription_details). */
	invoiceSubscription(invoiceId: string): Promise<string | null>;
	/** The subscription id behind a charge, via its invoice. Null for one-time charges. */
	subscriptionForCharge(chargeId: string): Promise<string | null>;
	/** Retrieve a checkout session (success-page ensure path, PRD §13/§14). */
	getCheckoutSession(sessionId: string): Promise<Record<string, unknown> | null>;
	/**
	 * Onboard a product: create the two prices (one-time lifetime + recurring yearly) and
	 * register the webhook endpoint, returning the ids and signing secret. Idempotent:
	 * re-running finds the existing Stripe product/webhook by the coolbeans_slug metadata.
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

/** Basil moved invoice.subscription under parent.subscription_details. Support both. */
function invoiceSubId(invoice: {
	subscription?: unknown;
	parent?: { subscription_details?: { subscription?: unknown } };
}): string | null {
	const direct = invoice.subscription;
	if (typeof direct === 'string') return direct;
	const nested = invoice.parent?.subscription_details?.subscription;
	return typeof nested === 'string' ? nested : null;
}

/** Production gateway backed by the official stripe SDK. */
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

export function createStripeGateway(secretKey: string, apiBase?: string): StripeGateway {
	// apiBase points the SDK at a local mock for journey tests; unset in production.
	const stripe = new Stripe(
		secretKey,
		apiBase
			? { host: hostOf(apiBase), port: portOf(apiBase), protocol: protocolOf(apiBase) }
			: undefined,
	);
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
		async sessionLineItems(sessionId) {
			const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 10 });
			return items.data
				.filter((li) => !!li.price?.id)
				.map((li) => ({ priceId: li.price?.id as string, quantity: li.quantity ?? 1 }));
		},
		async invoiceSubscription(invoiceId) {
			const invoice = (await stripe.invoices.retrieve(invoiceId)) as unknown as Parameters<
				typeof invoiceSubId
			>[0];
			return invoiceSubId(invoice);
		},
		async subscriptionForCharge(chargeId) {
			const charge = (await stripe.charges.retrieve(chargeId, {
				expand: ['invoice'],
			})) as unknown as { invoice?: unknown };
			const invoice = charge.invoice;
			if (invoice && typeof invoice === 'object') {
				return invoiceSubId(invoice as Parameters<typeof invoiceSubId>[0]);
			}
			if (typeof invoice === 'string') return this.invoiceSubscription(invoice);
			return null;
		},
		async getCheckoutSession(sessionId) {
			try {
				const session = await stripe.checkout.sessions.retrieve(sessionId);
				return session as unknown as Record<string, unknown>;
			} catch {
				return null;
			}
		},
		async billingPortalSession(customerId, returnUrl) {
			const session = await stripe.billingPortal.sessions.create({
				customer: customerId,
				return_url: returnUrl,
			});
			return session.url;
		},
		async connect(args) {
			// Idempotent by coolbeans_slug metadata: reuse the existing Stripe product,
			// its prices, and the webhook endpoint if a previous run created them.
			const existingProducts = await stripe.products.list({ limit: 100, active: true });
			let product = existingProducts.data.find(
				(p) => p.metadata?.coolbeans_slug === args.productSlug,
			);
			product ??= await stripe.products.create({
				name: args.productName,
				metadata: { coolbeans_slug: args.productSlug },
			});

			const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
			let lifetime = prices.data.find((p) => !p.recurring);
			lifetime ??= await stripe.prices.create({
				product: product.id,
				currency: args.currency,
				unit_amount: args.lifetimeAmount,
			});
			let yearly = prices.data.find((p) => p.recurring?.interval === 'year');
			yearly ??= await stripe.prices.create({
				product: product.id,
				currency: args.currency,
				unit_amount: args.yearlyAmount,
				recurring: { interval: 'year' },
			});

			const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
			let endpoint = endpoints.data.find((e) => e.url === args.webhookUrl);
			endpoint ??= await stripe.webhookEndpoints.create({
				url: args.webhookUrl,
				enabled_events: [
					'checkout.session.completed',
					'checkout.session.async_payment_succeeded',
					'charge.refunded',
					'charge.dispute.created',
					// Without the close event a dispute we win never gives access back.
					'charge.dispute.closed',
					'customer.subscription.updated',
					'customer.subscription.deleted',
				],
				metadata: { coolbeans_slug: args.productSlug },
			});
			return {
				lifetimePriceId: lifetime.id,
				yearlyPriceId: yearly.id,
				// The secret is only returned at creation; a reused endpoint keeps its stored secret.
				webhookSecret: endpoint.secret ?? '',
			};
		},
	};
}
