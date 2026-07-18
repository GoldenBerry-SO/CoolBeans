// ABOUTME: Stripe onboarding (PRD §13) — create prices + register the webhook, store on the product.
// ABOUTME: The five-minute job: one call leaves a product fully wired, no manual dashboard steps.

import type { Product } from '@coolbeans/db';
import { products } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { writeAudit } from '../store/audit.js';

export interface ConnectArgs {
	actor?: string;
	product: Product;
	webhookUrl: string;
	lifetimeAmount: number;
	yearlyAmount: number;
	currency?: string;
}

export interface ConnectResult {
	lifetimePriceId: string;
	yearlyPriceId: string;
	/** Where to point Stripe: the secret is per product, so the global route cannot verify it. */
	webhookPath: string;
	/** False when Stripe reused an endpoint and returned no secret (the stored one was kept). */
	secretRotated: boolean;
}

/** Wire a product to Stripe and persist the price ids + webhook secret. */
export async function connectStripe(deps: AppDeps, args: ConnectArgs): Promise<ConnectResult> {
	if (!deps.stripe) throw new Error('Stripe is not configured on this server.');
	const result = await deps.stripe.connect({
		productName: args.product.name,
		productSlug: args.product.slug,
		webhookUrl: args.webhookUrl,
		lifetimeAmount: args.lifetimeAmount,
		yearlyAmount: args.yearlyAmount,
		currency: args.currency ?? 'usd',
	});
	// Stripe only reveals a signing secret when it CREATES an endpoint. Re-running
	// connect against an existing one returns nothing, so writing it through would
	// blank the stored secret and every later webhook would fail verification.
	deps.db
		.update(products)
		.set({
			stripePriceLifetime: result.lifetimePriceId,
			stripePriceYearly: result.yearlyPriceId,
			...(result.webhookSecret ? { stripeWebhookSecret: result.webhookSecret } : {}),
		})
		.where(eq(products.id, args.product.id))
		.run();
	writeAudit(deps.db, {
		action: 'product.stripe_connected',
		actor: args.actor ?? 'admin',
		productId: args.product.id,
		detail: { lifetime: result.lifetimePriceId, yearly: result.yearlyPriceId },
	});
	return {
		lifetimePriceId: result.lifetimePriceId,
		yearlyPriceId: result.yearlyPriceId,
		// The secret is stored per product, so only the per-product route can verify
		// these deliveries. Point Stripe here, not at the global endpoint.
		webhookPath: `/v1/stripe/webhook/${args.product.slug}`,
		secretRotated: Boolean(result.webhookSecret),
	};
}
