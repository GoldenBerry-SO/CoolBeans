// ABOUTME: Grant lifecycle (issue #62) — map an arbitrary Stripe price to a product, or retire one.
// ABOUTME: This is how a vendor prices however they like (monthly, tiers, add-ons); pricing lives in Stripe.

import type { LicenseGrant, Product } from '@coolbeans/db';
import { licenseGrants } from '@coolbeans/db';
import { and, eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { writeAudit } from '../store/audit.js';
import { getConnection, listGrantsForProduct } from '../store/grants.js';
import { assertNotBillingPrice } from './billing.js';

export interface CreateGrantArgs {
	product: Product;
	priceId: string;
	kind: 'perpetual' | 'subscription';
	/** The vendor's free-form plan label, snapshotted onto every licence this grant issues. */
	plan?: string | null;
	actor: string;
}

/**
 * A one-time price issues a perpetual licence; a recurring price a subscription. Pointing a
 * perpetual grant at a recurring price (or the reverse) would issue the wrong entitlement on
 * every sale, and a typo'd id would match nothing at checkout and silently issue no key to a
 * paying buyer. Confirm the price exists and its mode before writing the grant.
 */
async function assertPriceModeForKind(
	deps: AppDeps,
	priceId: string,
	kind: 'perpetual' | 'subscription',
): Promise<void> {
	if (!deps.stripe) throw new Error('Stripe is not configured on this server.');
	const price = await deps.stripe.getPrice(priceId);
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
export async function createGrant(deps: AppDeps, args: CreateGrantArgs): Promise<LicenseGrant> {
	// Same reserved-price guard connect uses: our own Pro price must never resolve to a product.
	assertNotBillingPrice(deps, args.priceId);
	await assertPriceModeForKind(deps, args.priceId, args.kind);

	// Grants hang off a connection whose composite tenant FK must match the product's account.
	// Only the seeded self-host connection exists today; cloud accounts get their own with Connect.
	const connection = await getConnection(deps.db);
	if (!connection || connection.accountId !== args.product.accountId) {
		throw badRequest('Stripe is not connected for this account yet.');
	}

	const [grant] = await deps.db
		.insert(licenseGrants)
		.values({
			accountId: connection.accountId,
			stripeConnectionId: connection.id,
			stripePriceId: args.priceId,
			productId: args.product.id,
			kind: args.kind,
			plan: args.plan ?? null,
			status: 'active',
		})
		.onConflictDoUpdate({
			target: [licenseGrants.stripeConnectionId, licenseGrants.stripePriceId],
			set: {
				productId: args.product.id,
				kind: args.kind,
				plan: args.plan ?? null,
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
		detail: { price: args.priceId, kind: args.kind, plan: args.plan ?? null },
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
