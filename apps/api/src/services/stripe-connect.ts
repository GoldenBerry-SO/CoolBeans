// ABOUTME: Stripe onboarding (PRD §13) — register the connection's webhook endpoint, nothing else.
// ABOUTME: Prices are mapped in the grants API; the two-price model that lived here retired grants.

import type { Product } from '@coolbeans/db';
import { stripeConnections } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { badRequest } from '../http/errors.js';
import { writeAudit } from '../store/audit.js';
import { getActiveConnectionForAccount } from '../store/grants.js';

export interface ConnectArgs {
	actor?: string;
	product: Product;
	webhookUrl: string;
}

export interface ConnectResult {
	/** Where to point Stripe: the connection-level endpoint, one per connection. */
	webhookPath: string;
	/** False when Stripe reused an endpoint and returned no secret (the stored one was kept). */
	secretRotated: boolean;
	/** The one Stripe setting connect cannot make for you (PRD §13). */
	dunning: DunningRequirement;
	/** Set for a cloud Connect account, whose events already arrive on the platform endpoint. */
	note?: string;
}

export interface DunningRequirement {
	setting: string;
	note: string;
}

/**
 * Stripe's post-retry action is an account-level Billing setting with no API to read or
 * write, so connect cannot verify it — it can only say it plainly. It matters: our
 * subscription-lapse signal is customer.subscription.deleted, which Stripe only sends when that
 * action is "cancel". Left on "mark unpaid", a subscriber who stops paying keeps working
 * software. (The unpaid handler is belt-and-braces for exactly this, but a setting the
 * operator never saw is not a plan.)
 */
export const DUNNING_REQUIREMENT: DunningRequirement = {
	setting: 'cancel_subscription',
	note: 'In Stripe → Billing → Subscriptions and emails, set the action after all retries fail to "Cancel the subscription". That is what tells Cool Beans a yearly licence has lapsed.',
};

/**
 * Register the connection's webhook endpoint and store its signing secret.
 *
 * That is the whole job. Prices are mapped in the grants API, one price at a time, and connect
 * never touches a grant: its predecessor took a lifetime and a yearly price and retired every
 * active grant on the product that was not one of the two, so an operator who had mapped three
 * prices and then clicked Connect silently lost the third.
 */
export async function connectStripe(deps: AppDeps, args: ConnectArgs): Promise<ConnectResult> {
	// The connection is the unit of webhook identity: one endpoint, one secret, shared by every
	// product on it. A product on an account with no connection fails clean here instead of
	// hitting a foreign-key violation later.
	const connection = await getActiveConnectionForAccount(deps.db, args.product.accountId);
	if (!connection) {
		throw badRequest('Stripe is not connected for this account yet.');
	}
	// A Connect vendor's events already arrive on the platform endpoint, verified with the
	// platform secret. Registering an endpoint on their account would mint a secret nothing
	// verifies against, so there is genuinely nothing to do — say so rather than refuse.
	if (connection.mode === 'cloud_connect') {
		return {
			webhookPath: '/v1/connect/stripe/webhook',
			secretRotated: false,
			dunning: DUNNING_REQUIREMENT,
			note: 'This account sells through Stripe Connect, so its events already reach us on the platform endpoint. There is nothing to register.',
		};
	}
	if (!deps.stripe) throw new Error('Stripe is not configured on this server.');

	// One endpoint per connection: register the connection-level path regardless of the URL the
	// caller passed. Two products registering two per-product URLs would make Stripe mint two
	// endpoints with two secrets, and only the last would be stored — every later delivery for
	// the first product would then fail signature verification.
	const webhookUrl = new URL('/v1/stripe/webhook', args.webhookUrl).toString();
	const result = await deps.stripe.connect({ productSlug: args.product.slug, webhookUrl });
	// Stripe only reveals a signing secret when it CREATES an endpoint. Re-running connect
	// against an existing one returns nothing, so writing it through would blank the stored
	// secret and every later webhook would fail verification.
	if (result.webhookSecret) {
		await deps.db
			.update(stripeConnections)
			.set({ webhookSecret: result.webhookSecret })
			.where(eq(stripeConnections.id, connection.id));
	}
	await writeAudit(deps.db, {
		action: 'product.stripe_connected',
		actor: args.actor ?? 'admin',
		productId: args.product.id,
		detail: { webhook: webhookUrl, secretRotated: Boolean(result.webhookSecret) },
	});
	return {
		webhookPath: '/v1/stripe/webhook',
		secretRotated: Boolean(result.webhookSecret),
		dunning: DUNNING_REQUIREMENT,
	};
}
