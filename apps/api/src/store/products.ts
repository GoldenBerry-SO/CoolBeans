// ABOUTME: Product data access — lookups by slug/prefix and the prefix list for key normalization.
// ABOUTME: Thin wrappers over Drizzle so services never hand-roll product queries.

import type { Database, Product } from '@coolbeans/db';
import { products } from '@coolbeans/db';
import { eq } from 'drizzle-orm';

export function getProductBySlug(db: Database, slug: string): Product | undefined {
	return db.select().from(products).where(eq(products.slug, slug)).get();
}

export function getProductByPrefix(db: Database, prefix: string): Product | undefined {
	return db.select().from(products).where(eq(products.keyPrefix, prefix.toUpperCase())).get();
}

export function getProductById(db: Database, id: number): Product | undefined {
	return db.select().from(products).where(eq(products.id, id)).get();
}

export function listProducts(db: Database): Product[] {
	return db.select().from(products).all();
}

/** All known key prefixes, for resolving a key to its product at the public edge. */
export function listPrefixes(db: Database): string[] {
	return db
		.select({ prefix: products.keyPrefix })
		.from(products)
		.all()
		.map((r) => r.prefix);
}
