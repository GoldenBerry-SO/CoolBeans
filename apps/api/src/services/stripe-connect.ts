// ABOUTME: Stripe onboarding (PRD §13) — reference the vendor's prices + register the webhook.
// ABOUTME: The five-minute job: one call leaves a product fully wired, no manual dashboard steps.

import type { Product } from '@coolbeans/db';
import { licenseGrants, stripeConnections } from '@coolbeans/db';
import { and, eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { badRequest } from '../http/errors.js';
import { writeAudit } from '../store/audit.js';
import { getConnection } from '../store/grants.js';
import { assertDistinctTierPrices, assertNotBillingPrice } from './billing.js';

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

/**
 * Confirm each referenced price exists in the vendor's account and is the right billing mode
 * for its tier. A lifetime tier pointed at a recurring price (or a yearly at a one-time one)
 * would issue the wrong entitlement on every sale, and a typo'd id would match nothing at
 * checkout and silently issue no key to a paying buyer. Fail loudly here instead.
 */
async function assertTierPriceModes(
	deps: AppDeps,
	lifetimePriceId: string,
	yearlyPriceId: string,
): Promise<void> {
	const stripe = deps.stripe;
	if (!stripe) throw new Error('Stripe is not configured on this server.');
	const [lifetime, yearly] = await Promise.all([
		stripe.getPrice(lifetimePriceId),
		stripe.getPrice(yearlyPriceId),
	]);
	if (!lifetime) {
		throw badRequest(`No active Stripe price ${lifetimePriceId} in your account. Check the id.`);
	}
	if (lifetime.recurring) {
		throw badRequest(
			'The lifetime tier needs a one-time price, but that Stripe price is recurring.',
		);
	}
	if (!yearly) {
		throw badRequest(`No active Stripe price ${yearlyPriceId} in your account. Check the id.`);
	}
	if (!yearly.recurring) {
		throw badRequest('The yearly tier needs a recurring price, but that Stripe price is one-time.');
	}
	// A monthly (or weekly/daily) price is recurring but renews sooner, so each "yearly"
	// licence would expire at that shorter period. The tier means an annual subscription.
	if (yearly.interval !== 'year') {
		throw badRequest(
			`The yearly tier needs a price that renews once a year, not every ${yearly.interval ?? 'billing period'}.`,
		);
	}
}

/** Wire a product to Stripe and persist the price ids + webhook secret. */
export async function connectStripe(deps: AppDeps, args: ConnectArgs): Promise<ConnectResult> {
	if (!deps.stripe) throw new Error('Stripe is not configured on this server.');
	// Validate everything before any side effect (webhook registration, DB write), so a bad
	// configuration fails clean and leaves nothing half-wired.
	//
	// The two tiers must differ: price resolution checks the lifetime column first, so a
	// shared id would issue every sale for it — a yearly subscription included — as lifetime.
	assertDistinctTierPrices(args.lifetimePriceId, args.yearlyPriceId);
	// The vendor pastes their own price ids, so a shared Stripe account (which config refuses
	// in production) is the only way one could be our platform Pro price. Assert it anyway:
	// the failure it prevents is a Pro payment issuing somebody a licence key.
	assertNotBillingPrice(deps, args.lifetimePriceId, args.yearlyPriceId);
	await assertTierPriceModes(deps, args.lifetimePriceId, args.yearlyPriceId);

	// Grants and the webhook secret hang off a connection, and the composite tenant FK
	// requires that connection to belong to the product's account. Only the seeded self-host
	// connection exists today (cloud accounts get their own in the Stripe Connect work), so a
	// product on any other account fails clean here instead of hitting a foreign-key violation.
	const connection = await getConnection(deps.db);
	if (!connection || connection.accountId !== args.product.accountId) {
		throw badRequest('Stripe is not connected for this account yet.');
	}

	const result = await deps.stripe.connect({
		productSlug: args.product.slug,
		webhookUrl: args.webhookUrl,
		lifetimePriceId: args.lifetimePriceId,
		yearlyPriceId: args.yearlyPriceId,
	});
	// Map the two prices to grants on the connection: the one-time price grants a perpetual
	// licence, the recurring one a subscription.
	const mappings = [
		{ priceId: result.lifetimePriceId, kind: 'perpetual' as const },
		{ priceId: result.yearlyPriceId, kind: 'subscription' as const },
	];
	const keep = new Set(mappings.map((m) => m.priceId));
	await deps.db.transaction(async (tx) => {
		// Retire any active grant on this product the new mapping no longer includes, so a
		// checkout link for a price the vendor rewired away stops issuing. Grants are
		// retire-and-recreate, never edited, so an old link leaves an audit trail.
		const active = await tx
			.select()
			.from(licenseGrants)
			.where(and(eq(licenseGrants.productId, args.product.id), eq(licenseGrants.status, 'active')));
		for (const g of active) {
			if (keep.has(g.stripePriceId)) continue;
			await tx
				.update(licenseGrants)
				.set({ status: 'retired', retiredAt: nowDate(deps).toISOString() })
				.where(eq(licenseGrants.id, g.id));
		}
		// Upsert by (connection, price) so re-running connect is idempotent and re-wiring an
		// existing price just refreshes it (and un-retires it if it was retired before).
		for (const m of mappings) {
			await tx
				.insert(licenseGrants)
				.values({
					accountId: connection.accountId,
					stripeConnectionId: connection.id,
					stripePriceId: m.priceId,
					productId: args.product.id,
					kind: m.kind,
					status: 'active',
				})
				.onConflictDoUpdate({
					target: [licenseGrants.stripeConnectionId, licenseGrants.stripePriceId],
					set: { productId: args.product.id, kind: m.kind, status: 'active', retiredAt: null },
				});
		}
	});
	// Stripe only reveals a signing secret when it CREATES an endpoint. Re-running connect
	// against an existing one returns nothing, so writing it through would blank the stored
	// secret and every later webhook would fail verification. The secret lives on the
	// connection now, not the product.
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
		detail: { perpetual: result.lifetimePriceId, subscription: result.yearlyPriceId },
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
