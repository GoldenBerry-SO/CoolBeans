// ABOUTME: Provider-id purchase lookup shared by issuance and out-of-order reconciliation.
// ABOUTME: Kept outside those services so reconciliation can run before key delivery without a cycle.

import type { Product } from '@coolbeans/db';
import { type License, licenses, purchases } from '@coolbeans/db';
import { eq, or } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { getProductById } from './products.js';

/** Find the license behind a purchase matched by any provider id. */
export function findLicenseByProviderId(
	deps: AppDeps,
	providerId: string,
): { license: License; product: Product } | undefined {
	const row = deps.db
		.select()
		.from(licenses)
		.innerJoin(purchases, eq(purchases.id, licenses.purchaseId))
		.where(
			or(
				eq(purchases.providerSubscriptionId, providerId),
				eq(purchases.providerPaymentId, providerId),
				eq(purchases.providerCheckoutId, providerId),
			),
		)
		.get();
	if (!row) return undefined;
	const product = getProductById(deps.db, row.licenses.productId);
	return product ? { license: row.licenses, product } : undefined;
}
