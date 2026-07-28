// ABOUTME: Per-product API tokens (PRD §13, §16) — scope the success-page lookup to one product.
// ABOUTME: Only a SHA-256 hash is stored; the plaintext token is shown once at creation/rotation.

import { createHash, randomBytes } from 'node:crypto';
import type { Product } from '@coolbeans/db';
import { products } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { writeAudit } from '../store/audit.js';

export function hashProductToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Generate and store a fresh token for a product, returning the plaintext ONCE. */
export async function issueProductToken(
	deps: AppDeps,
	product: Product,
	actor = 'admin',
): Promise<string> {
	const token = `cbp_${randomBytes(24).toString('hex')}`;
	await deps.db
		.update(products)
		.set({ productTokenHash: hashProductToken(token) })
		.where(eq(products.id, product.id));
	await writeAudit(deps.db, {
		action: 'product.token_rotated',
		actor,
		accountId: product.accountId,
		productId: product.id,
	});
	return token;
}

/**
 * Resolve a presented bearer token to its product, or null. The lookup hashes the
 * presented value first, so timing reveals nothing about any stored hash.
 */
export async function productForToken(
	deps: AppDeps,
	presented: string,
): Promise<Product | undefined> {
	if (!presented.startsWith('cbp_')) return undefined;
	const [row] = await deps.db
		.select()
		.from(products)
		.where(eq(products.productTokenHash, hashProductToken(presented)))
		.limit(1);
	return row;
}
