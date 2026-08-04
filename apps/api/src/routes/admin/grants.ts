// ABOUTME: Admin grant routes (issue #62) — map arbitrary Stripe prices to a product, list, retire.
// ABOUTME: This is the general pricing surface: perpetual or subscription, however the vendor prices in Stripe.

import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { badRequest } from '../../http/errors.js';
import { createGrant, listGrantsForProduct, retireGrant } from '../../services/grants.js';
import { gatewayForConnection } from '../../services/stripe-connection.js';
import type { StripePriceListing } from '../../services/stripe-gateway.js';
import { getActiveConnectionForAccount, listGrantsForConnection } from '../../store/grants.js';
import { auditActor, entitlementsSchema, readBody, requireProduct } from './util.js';

const grantBody = z.object({
	// A Stripe price id, like price_1QabcXYZ. The shape gate turns a fat-fingered id into a
	// clear 422 rather than a grant that silently matches no checkout.
	stripe_price_id: z
		.string()
		.regex(/^price_[A-Za-z0-9]+$/, 'Must be a Stripe price id, like price_123'),
	// Optional (#120): omitted, the kind is inferred from the price itself — recurring is a
	// subscription, one-time a perpetual. Provided, it must match, and a mismatch refuses.
	kind: z.enum(['perpetual', 'subscription']).optional(),
	// Free-form vendor label (e.g. "Pro monthly"), snapshotted onto issued licences. Display only.
	plan: z.string().min(1).optional(),
	// Seats this price buys. Omit to inherit the product's limit, which is what every grant did
	// before seats could be priced. Bounded to the int4 column, same reason as manual issuance.
	activation_limit: z.number().int().positive().max(2_147_483_647).optional(),
	/**
	 * Capabilities this price buys, e.g. { "export_4k": true, "batch_limit": 100 }. Omit to keep
	 * whatever the price already grants; send {} to clear them, which is the only way to take a
	 * capability off a price without retiring the mapping. Licences already issued keep theirs.
	 *
	 * Flat scalars only, names an app can read as a property, and a bounded number of them. Every
	 * one of these is signed into every token the price issues, and that token lives in an app's
	 * storage and travels on each validate — so this is not a place for an arbitrary blob. The
	 * console enforces the same name rule; if only the console did, the contract would be a
	 * convention rather than a rule.
	 */
	entitlements: entitlementsSchema.optional(),
});

export function registerAdminGrantRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	admin.get('/products/:slug/grants', async (c) => {
		const product = await requireProduct(c, deps, c.req.param('slug'));
		return c.json({ ok: true, grants: await listGrantsForProduct(deps.db, product.id) });
	});

	// The picker's browse list (#120): the connected account's active prices with the facts
	// a human recognizes — names, amounts, cadence — plus what each is already mapped to.
	// Pasting ids across dashboard tabs was how #118's wrong-account hour happened.
	admin.get('/products/:slug/stripe/prices', async (c) => {
		const product = await requireProduct(c, deps, c.req.param('slug'));
		const connection = await getActiveConnectionForAccount(deps.db, product.accountId);
		if (!connection) {
			throw badRequest('Stripe is not connected for this account yet.');
		}
		let prices: StripePriceListing[];
		try {
			prices = await gatewayForConnection(deps, connection).listPrices();
		} catch (err) {
			// The #119 rule: a refused listing is a credentials/access problem, and saying
			// anything else sends the operator hunting ghosts.
			throw badRequest(
				`Stripe refused the price listing: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		const grants = await listGrantsForConnection(deps.db, connection.id);
		const mappedBy = new Map(grants.map((g) => [g.stripePriceId, g]));
		// The display name turns "your price is in another account" from a riddle into a
		// glance. Cloud only: self-host's connection is the operator's own key.
		const accountName =
			connection.mode === 'cloud_connect' && connection.stripeAccountId && deps.connect
				? await deps.connect.getAccountName(connection.stripeAccountId)
				: null;
		return c.json({
			ok: true,
			connection: {
				mode: connection.mode,
				stripe_account_id: connection.mode === 'cloud_connect' ? connection.stripeAccountId : null,
				account_name: accountName,
			},
			prices: prices.map((p) => {
				const grant = mappedBy.get(p.id);
				return {
					id: p.id,
					nickname: p.nickname,
					product_name: p.productName,
					unit_amount: p.unitAmount,
					currency: p.currency,
					recurring: p.recurring,
					interval: p.interval ?? null,
					mapped:
						grant && grant.status === 'active'
							? { product: grant.productSlug, plan: grant.plan }
							: null,
				};
			}),
		});
	});

	admin.post('/products/:slug/grants', async (c) => {
		const product = await requireProduct(c, deps, c.req.param('slug'));
		const body = await readBody(c, grantBody);
		const grant = await createGrant(deps, {
			product,
			priceId: body.stripe_price_id,
			kind: body.kind,
			plan: body.plan ?? null,
			activationLimit: body.activation_limit ?? null,
			// Passed through as-is: undefined keeps what the price grants, {} clears it.
			entitlements: body.entitlements,
			actor: auditActor(c),
		});
		return c.json({ ok: true, grant });
	});

	admin.post('/products/:slug/grants/:id/retire', async (c) => {
		const product = await requireProduct(c, deps, c.req.param('slug'));
		const grantId = Number(c.req.param('id'));
		if (!Number.isInteger(grantId)) throw badRequest('Grant id must be an integer.');
		const grant = await retireGrant(deps, { product, grantId, actor: auditActor(c) });
		return c.json({ ok: true, grant });
	});
}
