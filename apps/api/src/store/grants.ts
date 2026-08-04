// ABOUTME: License-grant data access (issue #62) — resolve a Stripe price to a product + grant.
// ABOUTME: A grant is the whole pricing model: (connection, price) -> product, kind, plan.

import type { Database, LicenseGrant, Product, StripeConnection } from '@coolbeans/db';
import { licenseGrants, licenses, products, stripeConnections } from '@coolbeans/db';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';

/**
 * The connection every self-host issuance and the current single-connection flow runs on.
 * Cloud multi-vendor (Stripe Connect) resolves the connection from the event's account id.
 */
export const SELF_HOST_CONNECTION_ID = 1;

export interface GrantMatch {
	product: Product;
	grant: LicenseGrant;
}

/**
 * Resolve the active grant, and its product, for a Stripe price on a connection. The webhook
 * has no account in hand, so this is a global lookup scoped by the connection the event came
 * through; the (connection, price) unique makes exactly one grant match.
 */
export async function getGrantByPrice(
	db: Database,
	priceId: string,
	connectionId = SELF_HOST_CONNECTION_ID,
): Promise<GrantMatch | undefined> {
	const [row] = await db
		.select()
		.from(licenseGrants)
		.innerJoin(products, eq(products.id, licenseGrants.productId))
		.where(
			and(
				eq(licenseGrants.stripeConnectionId, connectionId),
				eq(licenseGrants.stripePriceId, priceId),
				eq(licenseGrants.status, 'active'),
			),
		)
		.limit(1);
	if (!row) return undefined;
	return { product: row.products, grant: row.license_grants };
}

/** Load a Stripe connection by id (defaults to the self-host connection). */
export async function getConnection(
	db: Database,
	id = SELF_HOST_CONNECTION_ID,
): Promise<StripeConnection | undefined> {
	const [row] = await db
		.select()
		.from(stripeConnections)
		.where(eq(stripeConnections.id, id))
		.limit(1);
	return row;
}

/**
 * The active connection an account issues through: the seeded self-host default for account 1,
 * or a cloud vendor's own Connect connection. One active connection per account, so grant
 * creation and price validation both hang off the right Stripe account for the tenant.
 */
export async function getActiveConnectionForAccount(
	db: Database,
	accountId: number,
): Promise<StripeConnection | undefined> {
	const [row] = await db
		.select()
		.from(stripeConnections)
		.where(and(eq(stripeConnections.accountId, accountId), eq(stripeConnections.status, 'active')))
		// A partial unique index allows only one active connection per account, so this returns
		// that one. Ordered anyway: if the invariant is ever relaxed, "whichever row came back
		// first" is not a decision anybody made.
		.orderBy(asc(stripeConnections.id))
		.limit(1);
	return row;
}

/**
 * Load a connection by its Stripe account id (acct_...). A Connect webhook names the connected
 * account it came from; stripe_account_id is unique, so that resolves to exactly one
 * connection, which is how a cloud event is bound to its tenant and never another.
 */
export async function getConnectionByStripeAccount(
	db: Database,
	stripeAccountId: string,
): Promise<StripeConnection | undefined> {
	const [row] = await db
		.select()
		.from(stripeConnections)
		.where(eq(stripeConnections.stripeAccountId, stripeAccountId))
		.limit(1);
	return row;
}

/** The active grants on a product, newest first, for the console and audit. */
/**
 * Every capability name a licence for this product might carry, deduped and sorted. Names come
 * from grants AND issued licences, because they are two real sources: a price maps a capability
 * through a grant, and a hand-issued licence (a comp, a support replacement, a vendor with no
 * Stripe wired) names its own. Reading grants alone told a manual-only vendor's brief "this
 * product grants no capabilities" while every key it issued carried one.
 *
 * Retired grants and disabled licences count: a licence that carries a name means an app must
 * honour it, and a listed-but-unsold name costs nothing, since absent reads as off.
 */
export async function entitlementNamesForProduct(
	db: Database,
	productId: number,
): Promise<string[]> {
	// DISTINCT and NOT NULL, because this feeds an unauthenticated endpoint. Every grant-issued
	// licence carries its snapshot, so without them each public brief fetch would read one jsonb
	// per licence ever sold; distinct capability maps number one per tier, however many sell.
	const [grantRows, licenceRows] = await Promise.all([
		db
			.selectDistinct({ entitlements: licenseGrants.entitlements })
			.from(licenseGrants)
			.where(and(eq(licenseGrants.productId, productId), isNotNull(licenseGrants.entitlements))),
		db
			.selectDistinct({ entitlements: licenses.entitlements })
			.from(licenses)
			.where(and(eq(licenses.productId, productId), isNotNull(licenses.entitlements))),
	]);
	return [
		...new Set(
			[...grantRows, ...licenceRows].flatMap((row) => Object.keys(row.entitlements ?? {})),
		),
	].sort();
}

export async function listGrantsForProduct(
	db: Database,
	productId: number,
): Promise<LicenseGrant[]> {
	return db
		.select()
		.from(licenseGrants)
		.where(and(eq(licenseGrants.productId, productId), eq(licenseGrants.status, 'active')))
		.orderBy(desc(licenseGrants.createdAt));
}

/**
 * Every active grant on a connection with the product it points at, for the price picker's
 * "already mapped" badges (#120). A price is unambiguous within one connection, so this is
 * the whole mapping picture the picker needs.
 */
export async function listGrantsForConnection(
	db: Database,
	connectionId: number,
): Promise<
	Array<{ stripePriceId: string; status: string; plan: string | null; productSlug: string }>
> {
	const rows = await db
		.select({
			stripePriceId: licenseGrants.stripePriceId,
			status: licenseGrants.status,
			plan: licenseGrants.plan,
			productSlug: products.slug,
		})
		.from(licenseGrants)
		.innerJoin(products, eq(products.id, licenseGrants.productId))
		.where(eq(licenseGrants.stripeConnectionId, connectionId));
	return rows;
}
