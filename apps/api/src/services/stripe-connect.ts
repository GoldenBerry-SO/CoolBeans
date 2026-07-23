// ABOUTME: Stripe onboarding (PRD §13) — reference the vendor's prices + register the webhook.
// ABOUTME: The five-minute job: one call leaves a product fully wired, no manual dashboard steps.

import type { Product } from '@coolbeans/db';
import { products } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { writeAudit } from '../store/audit.js';
import { assertNotBillingPrice } from './billing.js';

export interface ConnectArgs {
	actor?: string;
	product: Product;
	webhookUrl: string;
	/** The vendor's existing Stripe price id whose checkout issues a lifetime licence. */
	lifetimePriceId: string;
	/** The vendor's existing Stripe price id whose subscription issues a yearly licence. */
	yearlyPriceId: string;
}

export interface ConnectResult {
	lifetimePriceId: string;
	yearlyPriceId: string;
	/** Where to point Stripe: the secret is per product, so the global route cannot verify it. */
	webhookPath: string;
	/** False when Stripe reused an endpoint and returned no secret (the stored one was kept). */
	secretRotated: boolean;
	/** The one Stripe setting connect cannot make for you (PRD §13). */
	dunning: DunningRequirement;
}

export interface DunningRequirement {
	setting: string;
	note: string;
}

/**
 * Stripe's post-retry action is an account-level Billing setting with no API to read or
 * write, so connect cannot verify it — it can only say it plainly. It matters: our
 * yearly-lapse signal is customer.subscription.deleted, which Stripe only sends when that
 * action is "cancel". Left on "mark unpaid", a subscriber who stops paying keeps working
 * software. (The unpaid handler is belt-and-braces for exactly this, but a setting the
 * operator never saw is not a plan.)
 */
export const DUNNING_REQUIREMENT: DunningRequirement = {
	setting: 'cancel_subscription',
	note: 'In Stripe → Billing → Subscriptions and emails, set the action after all retries fail to "Cancel the subscription". That is what tells Cool Beans a yearly licence has lapsed.',
};

/** Wire a product to Stripe and persist the price ids + webhook secret. */
export async function connectStripe(deps: AppDeps, args: ConnectArgs): Promise<ConnectResult> {
	if (!deps.stripe) throw new Error('Stripe is not configured on this server.');
	const result = await deps.stripe.connect({
		productSlug: args.product.slug,
		webhookUrl: args.webhookUrl,
		lifetimePriceId: args.lifetimePriceId,
		yearlyPriceId: args.yearlyPriceId,
	});
	// The vendor pastes their own price ids, so a shared Stripe account (which config
	// refuses in production) is the only way one could be our platform Pro price. Assert
	// it anyway: the failure it prevents is a Pro payment issuing somebody a licence key,
	// and a paste makes that mistake easier than the old create-under-their-key flow did.
	assertNotBillingPrice(deps, result.lifetimePriceId, result.yearlyPriceId);
	// Stripe only reveals a signing secret when it CREATES an endpoint. Re-running
	// connect against an existing one returns nothing, so writing it through would
	// blank the stored secret and every later webhook would fail verification.
	await deps.db
		.update(products)
		.set({
			stripePriceLifetime: result.lifetimePriceId,
			stripePriceYearly: result.yearlyPriceId,
			...(result.webhookSecret ? { stripeWebhookSecret: result.webhookSecret } : {}),
		})
		.where(eq(products.id, args.product.id));
	await writeAudit(deps.db, {
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
		dunning: DUNNING_REQUIREMENT,
	};
}
