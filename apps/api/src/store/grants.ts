// ABOUTME: License-grant data access (issue #62) — resolve a Stripe price to a product + grant.
// ABOUTME: A grant is the whole pricing model: (connection, price) -> product, kind, plan.

import type { Database, LicenseGrant, Product, StripeConnection } from '@coolbeans/db';
import { licenseGrants, products, stripeConnections } from '@coolbeans/db';
import { and, desc, eq } from 'drizzle-orm';

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

/** The active grants on a product, newest first, for the console and audit. */
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
