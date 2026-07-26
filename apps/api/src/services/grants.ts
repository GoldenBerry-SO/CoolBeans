// ABOUTME: Grant lifecycle (issue #62) — map an arbitrary Stripe price to a product, or retire one.
// ABOUTME: This is how a vendor prices however they like (monthly, tiers, add-ons); pricing lives in Stripe.

import type { LicenseGrant, Product } from '@coolbeans/db';
import { licenseGrants } from '@coolbeans/db';
import { and, eq, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { writeAudit } from '../store/audit.js';
import { getActiveConnectionForAccount, listGrantsForProduct } from '../store/grants.js';
import { assertNotBillingPrice } from './billing.js';
import { gatewayForConnection } from './stripe-connection.js';
import type { StripeGateway } from './stripe-gateway.js';

export interface CreateGrantArgs {
	product: Product;
	priceId: string;
	kind: 'perpetual' | 'subscription';
	/** The vendor's free-form plan label, snapshotted onto every licence this grant issues. */
	plan?: string | null;
	/** Seats this price buys. Null inherits the product's limit. */
	activationLimit?: number | null;
	/**
	 * The capabilities this price buys, e.g. `{ export_4k: true, batch_limit: 100 }`. Null keeps
	 * whatever the price already grants. Server-authored and signed into every token, which is
	 * what makes it safe for an app to gate a feature on, unlike the display-only `plan`.
	 */
	entitlements?: Record<string, boolean | number | string> | null;
	actor: string;
}

/**
 * A one-time price issues a perpetual licence; a recurring price a subscription. Pointing a
 * perpetual grant at a recurring price (or the reverse) would issue the wrong entitlement on
 * every sale, and a typo'd id would match nothing at checkout and silently issue no key to a
 * paying buyer. Confirm the price exists and its mode before writing the grant.
 */
async function assertPriceModeForKind(
	// The gateway bound to the connection the grant will hang off, NOT deps.stripe: a cloud
	// vendor's price lives in their connected account and is invisible to the platform key.
	stripe: StripeGateway,
	priceId: string,
	kind: 'perpetual' | 'subscription',
): Promise<void> {
	const price = await stripe.getPrice(priceId);
	if (!price) {
		throw badRequest(`No active Stripe price ${priceId} in your account. Check the id.`);
	}
	if (kind === 'perpetual' && price.recurring) {
		throw badRequest(
			'A perpetual grant needs a one-time price, but that Stripe price is recurring.',
		);
	}
	if (kind === 'subscription' && !price.recurring) {
		throw badRequest(
			'A subscription grant needs a recurring price, but that Stripe price is one-time.',
		);
	}
}

/**
 * Map a Stripe price to a product on the vendor's connection. Idempotent by (connection,
 * price): re-mapping a price just refreshes it (and un-retires it). A price already mapped to
 * another product is moved here, since a price resolves to exactly one product.
 */
/**
 * An empty map is not a capability map. Absent and empty mean different things everywhere else —
 * a signed `entitlements: {}` claims there is one — so they cannot differ here either, and a
 * caller sending `{}` means "no capabilities", not "clear what this price grants".
 */
function entitlementsOrNull(
	entitlements: CreateGrantArgs['entitlements'],
): Record<string, boolean | number | string> | null {
	if (!entitlements || Object.keys(entitlements).length === 0) return null;
	return entitlements;
}

export async function createGrant(deps: AppDeps, args: CreateGrantArgs): Promise<LicenseGrant> {
	// Same reserved-price guard connect uses: our own Pro price must never resolve to a product.
	assertNotBillingPrice(deps, args.priceId);

	// Grants hang off the account's own active connection (self-host default, or a cloud
	// vendor's Connect connection), whose composite tenant FK matches the product's account.
	// Resolved BEFORE the price is checked, because which Stripe account to ask is the
	// connection's to say.
	const connection = await getActiveConnectionForAccount(deps.db, args.product.accountId);
	if (!connection) {
		throw badRequest('Stripe is not connected for this account yet.');
	}
	await assertPriceModeForKind(gatewayForConnection(deps, connection), args.priceId, args.kind);

	const [grant] = await deps.db
		.insert(licenseGrants)
		.values({
			accountId: connection.accountId,
			stripeConnectionId: connection.id,
			stripePriceId: args.priceId,
			productId: args.product.id,
			kind: args.kind,
			plan: args.plan ?? null,
			activationLimit: args.activationLimit ?? null,
			entitlements: entitlementsOrNull(args.entitlements),
			status: 'active',
		})
		.onConflictDoUpdate({
			target: [licenseGrants.stripeConnectionId, licenseGrants.stripePriceId],
			set: {
				productId: args.product.id,
				kind: args.kind,
				// Omitting these keeps what the price already grants rather than clearing it.
				// Seats decide what future licences are worth, so a caller who re-maps a price to
				// change its label must not silently reset Pro's ten seats to the product default.
				// Clearing one is deliberate: retire the grant and map the price again.
				plan: sql`coalesce(${args.plan ?? null}, ${licenseGrants.plan})`,
				activationLimit: sql`coalesce(${args.activationLimit ?? null}, ${licenseGrants.activationLimit})`,
				entitlements: sql`coalesce(${(() => {
					const value = entitlementsOrNull(args.entitlements);
					return value ? JSON.stringify(value) : null;
				})()}::jsonb, ${licenseGrants.entitlements})`,
				status: 'active',
				retiredAt: null,
			},
		})
		.returning();
	await writeAudit(deps.db, {
		action: 'grant.created',
		actor: args.actor,
		accountId: args.product.accountId,
		productId: args.product.id,
		detail: {
			price: args.priceId,
			kind: args.kind,
			plan: args.plan ?? null,
			seats: args.activationLimit ?? null,
			entitlements: args.entitlements ?? null,
		},
	});
	return grant;
}

/**
 * Retire a grant so it issues no more keys. Never deleted: a licence already issued keeps its
 * provenance, and an old checkout link resolves to nothing rather than a working key.
 */
export async function retireGrant(
	deps: AppDeps,
	args: { product: Product; grantId: number; actor: string },
): Promise<LicenseGrant> {
	const [grant] = await deps.db
		.select()
		.from(licenseGrants)
		.where(and(eq(licenseGrants.id, args.grantId), eq(licenseGrants.productId, args.product.id)))
		.limit(1);
	// Cross-tenant is 404, never 403: a grant on another account's product must not confirm it exists.
	if (!grant) throw notFound('No such grant for this product.');
	if (grant.status === 'retired') {
		throw conflict('grant_retired', 'That grant is already retired.');
	}
	const [updated] = await deps.db
		.update(licenseGrants)
		.set({ status: 'retired', retiredAt: nowDate(deps).toISOString() })
		.where(eq(licenseGrants.id, grant.id))
		.returning();
	await writeAudit(deps.db, {
		action: 'grant.retired',
		actor: args.actor,
		accountId: args.product.accountId,
		productId: args.product.id,
		detail: { price: grant.stripePriceId, kind: grant.kind },
	});
	return updated;
}

export { listGrantsForProduct };
