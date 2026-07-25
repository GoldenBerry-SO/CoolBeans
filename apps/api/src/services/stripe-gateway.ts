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

/** What connect needs to know about a referenced price: does it exist, and is it recurring. */
export interface StripePriceInfo {
	/** True for a subscription price, false for a one-time price. */
	recurring: boolean;
	/** The recurring cadence ('day' | 'week' | 'month' | 'year'); undefined for one-time. */
	interval?: string;
}

export interface SessionLineItem {
	priceId: string;
	quantity: number;
}

export interface StripeGateway {
	/**
	 * A gateway that reads a connected account's data (Stripe-Account header on every call).
	 * Stripe Connect deliveries carry the vendor's account, and their session/subscription
	 * live in that account, not the platform's. Self-host never calls this.
	 */
	forAccount(stripeAccount: string): StripeGateway;
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
	 * Onboard a product: register the webhook endpoint and return its signing secret.
	 * Pricing belongs to the vendor's Stripe account, so the two price ids are passed in
	 * (their existing lifetime + yearly prices) and echoed back for the caller to store —
	 * connect no longer creates prices. Idempotent: re-running finds the existing webhook
	 * by url and returns no secret, since Stripe only reveals it at creation.
	 */
	connect(args: {
		productSlug: string;
		webhookUrl: string;
		lifetimePriceId: string;
		yearlyPriceId: string;
	}): Promise<StripeConnectResult>;
	/**
	 * Look up a price the vendor referenced, to confirm it exists in their account and is the
	 * right billing mode for its tier. Null when Stripe has no such price (a typo, or a price
	 * from another account, which the vendor's key cannot see).
	 */
	getPrice(priceId: string): Promise<StripePriceInfo | null>;
	/**
	 * Redeem a Stripe Connect authorization code for the account that granted it.
	 *
	 * Stripe burns the code on first use, so this is the step that makes a replayed callback
	 * fail at the source rather than on our side alone. Null when the code is bad, spent or
	 * for another platform.
	 */
	exchangeConnectCode(code: string): Promise<ConnectedAccount | null>;
}

/** What a completed Connect authorization tells us: whose account, and which mode. */
export interface ConnectedAccount {
	stripeAccountId: string;
	livemode: boolean;
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

export function createStripeGateway(
	secretKey: string,
	apiBase?: string,
	// Set for a Stripe Connect scoped gateway: every read carries Stripe-Account, so it reads
	// the connected vendor's account, not the platform's. Unset for self-host and platform calls.
	stripeAccount?: string,
): StripeGateway {
	// apiBase points the SDK at a local mock for journey tests; unset in production.
	const stripe = new Stripe(
		secretKey,
		apiBase
			? { host: hostOf(apiBase), port: portOf(apiBase), protocol: protocolOf(apiBase) }
			: undefined,
	);
	// Merged into every connected-account read as the SDK's request options.
	const req: Stripe.RequestOptions | undefined = stripeAccount ? { stripeAccount } : undefined;
	return {
		forAccount(account: string) {
			return createStripeGateway(secretKey, apiBase, account);
		},
		constructEvent(rawBody, signature, secret) {
			return stripe.webhooks.constructEvent(rawBody, signature, secret) as unknown as StripeEvent;
		},
		async subscriptionPeriodEnd(subscriptionId) {
			const sub = await stripe.subscriptions.retrieve(subscriptionId, undefined, req);
			// Basil (2025-03-31) moved current_period_end onto subscription items.
			const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
			const end = item?.current_period_end;
			return end ? new Date(end * 1000).toISOString() : null;
		},
		async sessionLineItems(sessionId) {
			const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 10 }, req);
			return items.data
				.filter((li) => !!li.price?.id)
				.map((li) => ({ priceId: li.price?.id as string, quantity: li.quantity ?? 1 }));
		},
		async invoiceSubscription(invoiceId) {
			const invoice = (await stripe.invoices.retrieve(
				invoiceId,
				undefined,
				req,
			)) as unknown as Parameters<typeof invoiceSubId>[0];
			return invoiceSubId(invoice);
		},
		async subscriptionForCharge(chargeId) {
			const charge = (await stripe.charges.retrieve(
				chargeId,
				{ expand: ['invoice'] },
				req,
			)) as unknown as { invoice?: unknown };
			const invoice = charge.invoice;
			if (invoice && typeof invoice === 'object') {
				return invoiceSubId(invoice as Parameters<typeof invoiceSubId>[0]);
			}
			if (typeof invoice === 'string') return this.invoiceSubscription(invoice);
			return null;
		},
		async getCheckoutSession(sessionId) {
			try {
				const session = await stripe.checkout.sessions.retrieve(sessionId, undefined, req);
				return session as unknown as Record<string, unknown>;
			} catch {
				return null;
			}
		},
		async billingPortalSession(customerId, returnUrl) {
			// Scoped like every other call: a Connect vendor's customer lives in THEIR account,
			// so a portal session created on the platform account would find no such customer.
			const session = await stripe.billingPortal.sessions.create(
				{ customer: customerId, return_url: returnUrl },
				req,
			);
			return session.url;
		},
		async getPrice(priceId) {
			try {
				const price = await stripe.prices.retrieve(priceId, undefined, req);
				// An archived price can never be bought, so a tier pointed at one would take no
				// sales — the same silent failure as a missing price. Treat it as unusable.
				if (!price.active) return null;
				// Stripe returns a recurring object (with an interval) for subscriptions, null
				// for one-time prices.
				return { recurring: Boolean(price.recurring), interval: price.recurring?.interval };
			} catch {
				// resource_missing (or any lookup failure): treat as "cannot confirm this price".
				return null;
			}
		},
		async exchangeConnectCode(code) {
			try {
				// Deliberately NOT scoped by stripeAccount: this call IS how we learn which
				// account it is, and it authenticates as the platform.
				const token = await stripe.oauth.token({ grant_type: 'authorization_code', code });
				const account = token.stripe_user_id;
				if (!account) return null;
				return { stripeAccountId: account, livemode: Boolean(token.livemode) };
			} catch {
				// A spent, forged or foreign code: tell the caller nothing was authorized.
				return null;
			}
		},
		async connect(args) {
			// The vendor owns pricing, so connect does not create Stripe products or
			// prices any more — the two price ids come in already belonging to their
			// account. Its only side effect is registering the webhook so events reach
			// us. Idempotent by url: a re-run finds the existing endpoint.
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
				lifetimePriceId: args.lifetimePriceId,
				yearlyPriceId: args.yearlyPriceId,
				// The secret is only returned at creation; a reused endpoint keeps its stored secret.
				webhookSecret: endpoint.secret ?? '',
			};
		},
	};
}
