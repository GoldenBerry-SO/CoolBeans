// ABOUTME: Product data access — lookups by slug/prefix and the prefix list for key normalization.
// ABOUTME: Global lookups are named …Global; anything reached from /admin must use the account form.

import type { Database, Product } from '@coolbeans/db';
import { products } from '@coolbeans/db';
import { and, asc, eq, isNull } from 'drizzle-orm';

/**
 * Look a product up across every account.
 *
 * Legitimate callers are the ones with no account in hand: the public /v1 surface, the
 * provider webhook routes, and the slug-uniqueness check on creation (slugs are globally
 * unique because they appear in public URLs). Admin handlers must not use this — they
 * want requireProduct(), which resolves within the caller's account and 404s outside it.
 */
export async function getProductBySlugGlobal(
	db: Database,
	slug: string,
): Promise<Product | undefined> {
	const [row] = await db.select().from(products).where(eq(products.slug, slug)).limit(1);
	return row;
}

/** Look a product up inside one account. Returns undefined for another account's slug. */
export async function getAccountProductBySlug(
	db: Database,
	accountId: number,
	slug: string,
): Promise<Product | undefined> {
	const [row] = await db
		.select()
		.from(products)
		.where(and(eq(products.accountId, accountId), eq(products.slug, slug)))
		.limit(1);
	return row;
}

export async function getProductByPrefix(
	db: Database,
	prefix: string,
): Promise<Product | undefined> {
	const [row] = await db
		.select()
		.from(products)
		.where(eq(products.keyPrefix, prefix.toUpperCase()))
		.limit(1);
	return row;
}

export async function getProductById(db: Database, id: number): Promise<Product | undefined> {
	const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
	return row;
}

/** Every product on the instance. Admin listings want listAccountProducts instead. */
export async function listAllProducts(db: Database): Promise<Product[]> {
	return await db.select().from(products);
}

export async function listAccountProducts(db: Database, accountId: number): Promise<Product[]> {
	return await db
		.select()
		.from(products)
		.where(eq(products.accountId, accountId))
		.orderBy(asc(products.id));
}

/** Ids of an account's live products, for scoping queries that join on product_id. */
export async function liveProductIds(db: Database, accountId: number): Promise<number[]> {
	const rows = await db
		.select({ id: products.id })
		.from(products)
		.where(and(eq(products.accountId, accountId), isNull(products.archivedAt)));
	return rows.map((r) => r.id);
}

/** Ids of every product an account owns, archived included. */
export async function accountProductIds(db: Database, accountId: number): Promise<number[]> {
	const rows = await db
		.select({ id: products.id })
		.from(products)
		.where(eq(products.accountId, accountId));
	return rows.map((r) => r.id);
}

/**
 * All known key prefixes, for resolving a key to its product at the public edge.
 *
 * Deliberately NOT account-scoped, and it must stay that way. The public path resolves a
 * key with no account in hand, and PRD §8 says a valid key never stops validating.
 */
export async function listPrefixes(db: Database): Promise<string[]> {
	const rows = await db.select({ prefix: products.keyPrefix }).from(products);
	return rows.map((r) => r.prefix);
}

export interface PriceMatch {
	product: Product;
	kind: 'perpetual' | 'subscription';
}

/**
 * Resolve a product (and the grant kind) from a Stripe price id (PRD §13).
 *
 * The lifetime column maps to a perpetual entitlement, the yearly column to a subscription.
 * PR2 replaces these two columns with an arbitrary set of license_grants.
 */
export async function getProductByStripePrice(
	db: Database,
	priceId: string,
): Promise<PriceMatch | undefined> {
	const [lifetime] = await db
		.select()
		.from(products)
		.where(eq(products.stripePriceLifetime, priceId))
		.limit(1);
	if (lifetime) return { product: lifetime, kind: 'perpetual' };
	const [yearly] = await db
		.select()
		.from(products)
		.where(eq(products.stripePriceYearly, priceId))
		.limit(1);
	if (yearly) return { product: yearly, kind: 'subscription' };
	return undefined;
}
