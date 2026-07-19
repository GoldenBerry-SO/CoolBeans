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
export function getProductBySlugGlobal(db: Database, slug: string): Product | undefined {
	return db.select().from(products).where(eq(products.slug, slug)).get();
}

/** Look a product up inside one account. Returns undefined for another account's slug. */
export function getAccountProductBySlug(
	db: Database,
	accountId: number,
	slug: string,
): Product | undefined {
	return db
		.select()
		.from(products)
		.where(and(eq(products.accountId, accountId), eq(products.slug, slug)))
		.get();
}

export function getProductByPrefix(db: Database, prefix: string): Product | undefined {
	return db.select().from(products).where(eq(products.keyPrefix, prefix.toUpperCase())).get();
}

export function getProductById(db: Database, id: number): Product | undefined {
	return db.select().from(products).where(eq(products.id, id)).get();
}

/** Every product on the instance. Admin listings want listAccountProducts instead. */
export function listAllProducts(db: Database): Product[] {
	return db.select().from(products).all();
}

export function listAccountProducts(db: Database, accountId: number): Product[] {
	return db
		.select()
		.from(products)
		.where(eq(products.accountId, accountId))
		.orderBy(asc(products.id))
		.all();
}

/** Ids of an account's live products, for scoping queries that join on product_id. */
export function liveProductIds(db: Database, accountId: number): number[] {
	return db
		.select({ id: products.id })
		.from(products)
		.where(and(eq(products.accountId, accountId), isNull(products.archivedAt)))
		.all()
		.map((r) => r.id);
}

/** Ids of every product an account owns, archived included. */
export function accountProductIds(db: Database, accountId: number): number[] {
	return db
		.select({ id: products.id })
		.from(products)
		.where(eq(products.accountId, accountId))
		.all()
		.map((r) => r.id);
}

/**
 * All known key prefixes, for resolving a key to its product at the public edge.
 *
 * Deliberately NOT account-scoped, and it must stay that way. The public path resolves a
 * key with no account in hand, and PRD §8 says a valid key never stops validating.
 */
export function listPrefixes(db: Database): string[] {
	return db
		.select({ prefix: products.keyPrefix })
		.from(products)
		.all()
		.map((r) => r.prefix);
}

export interface PriceMatch {
	product: Product;
	tier: 'lifetime' | 'yearly';
}

/** Resolve a product (and its tier) from a Stripe price id (PRD §13). */
export function getProductByStripePrice(db: Database, priceId: string): PriceMatch | undefined {
	const lifetime = db
		.select()
		.from(products)
		.where(eq(products.stripePriceLifetime, priceId))
		.get();
	if (lifetime) return { product: lifetime, tier: 'lifetime' };
	const yearly = db.select().from(products).where(eq(products.stripePriceYearly, priceId)).get();
	if (yearly) return { product: yearly, tier: 'yearly' };
	return undefined;
}
