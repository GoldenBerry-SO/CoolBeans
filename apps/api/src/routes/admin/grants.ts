// ABOUTME: Admin grant routes (issue #62) — map arbitrary Stripe prices to a product, list, retire.
// ABOUTME: This is the general pricing surface: perpetual or subscription, however the vendor prices in Stripe.

import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { badRequest } from '../../http/errors.js';
import { createGrant, listGrantsForProduct, retireGrant } from '../../services/grants.js';
import { auditActor, readBody, requireProduct } from './util.js';

const grantBody = z.object({
	// A Stripe price id, like price_1QabcXYZ. The shape gate turns a fat-fingered id into a
	// clear 422 rather than a grant that silently matches no checkout.
	stripe_price_id: z
		.string()
		.regex(/^price_[A-Za-z0-9]+$/, 'Must be a Stripe price id, like price_123'),
	kind: z.enum(['perpetual', 'subscription']),
	// Free-form vendor label (e.g. "Pro monthly"), snapshotted onto issued licences. Display only.
	plan: z.string().min(1).optional(),
	// Seats this price buys. Omit to inherit the product's limit, which is what every grant did
	// before seats could be priced.
	activation_limit: z.number().int().positive().optional(),
});

export function registerAdminGrantRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	admin.get('/products/:slug/grants', async (c) => {
		const product = await requireProduct(c, deps, c.req.param('slug'));
		return c.json({ ok: true, grants: await listGrantsForProduct(deps.db, product.id) });
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
