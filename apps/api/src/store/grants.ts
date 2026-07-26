// ABOUTME: License-grant data access (issue #62) — resolve a Stripe price to a product + grant.
// ABOUTME: A grant is the whole pricing model: (connection, price) -> product, kind, plan.

import type { Database, LicenseGrant, Product, StripeConnection } from '@coolbeans/db';
import { licenseGrants, products, stripeConnections } from '@coolbeans/db';
import { and, asc, desc, eq } from 'drizzle-orm';

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
 * Every capability name a licence for this product might carry, deduped and sorted.
 *
 * Retired grants count: licences issued before a price was retired still carry its capabilities,
 * and an app that stops checking one takes a feature away from somebody who paid for it. A name
 * that is no longer sold costs nothing, since absent reads as off.
 */
export async function entitlementNamesForProduct(
	db: Database,
	productId: number,
): Promise<string[]> {
	const rows = await db
		.select({ entitlements: licenseGrants.entitlements })
		.from(licenseGrants)
		.where(eq(licenseGrants.productId, productId));
	return [...new Set(rows.flatMap((row) => Object.keys(row.entitlements ?? {})))].sort();
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
