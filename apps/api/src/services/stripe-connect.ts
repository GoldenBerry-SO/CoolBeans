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
	deps.db
		.update(products)
		.set({
			stripePriceLifetime: result.lifetimePriceId,
			stripePriceYearly: result.yearlyPriceId,
			stripeWebhookSecret: result.webhookSecret,
		})
		.where(eq(products.id, args.product.id))
		.run();
	writeAudit(deps.db, {
		action: 'product.stripe_connected',
		actor: args.actor ?? 'admin',
		productId: args.product.id,
		detail: { lifetime: result.lifetimePriceId, yearly: result.yearlyPriceId },
	});
	return { lifetimePriceId: result.lifetimePriceId, yearlyPriceId: result.yearlyPriceId };
}
