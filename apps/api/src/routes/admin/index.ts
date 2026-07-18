// ABOUTME: Admin API mount (PRD §16) — bearer-token authed product/key management + audit + signing keys.
// ABOUTME: All admin routes live under /admin behind constant-time token auth.

import { auditLog } from '@coolbeans/db';
import { OpenAPIHono } from '@hono/zod-openapi';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { notFound } from '../../http/errors.js';
import { adminAuth } from '../../middleware/admin-auth.js';
import { rotateKey } from '../../services/signing.js';
import { connectStripe } from '../../services/stripe-connect.js';
import { getProductBySlug } from '../../store/products.js';
import { registerAdminKeyRoutes } from './keys.js';
import { registerAdminProductRoutes } from './products.js';
import { readBody } from './util.js';

export function registerAdminRoutes(app: OpenAPIHono, deps: AppDeps): void {
	const admin = new OpenAPIHono();
	admin.use('*', adminAuth(deps.config.adminToken));

	registerAdminProductRoutes(admin, deps);
	registerAdminKeyRoutes(admin, deps);

	admin.get('/audit', (c) => {
		const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
		const rows = deps.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(limit).all();
		return c.json({
			ok: true,
			audit: rows.map((r) => ({
				id: r.id,
				action: r.action,
				actor: r.actor,
				product_id: r.productId,
				license_id: r.licenseId,
				detail: r.detail ? JSON.parse(r.detail) : null,
				created_at: r.createdAt,
			})),
		});
	});

	admin.post('/products/:slug/signing-keys/rotate', (c) => {
		const product = getProductBySlug(deps.db, c.req.param('slug'));
		if (!product) throw notFound('No product with that slug.');
		const key = rotateKey(deps, product.id);
		return c.json({ ok: true, signing_key: { kid: String(key.id), public_key: key.publicKey } });
	});

	const connectBody = z.object({
		webhook_url: z.string().url(),
		lifetime_amount: z.number().int().positive(),
		yearly_amount: z.number().int().positive(),
		currency: z.string().optional(),
	});
	admin.post('/products/:slug/stripe/connect', async (c) => {
		const product = getProductBySlug(deps.db, c.req.param('slug'));
		if (!product) throw notFound('No product with that slug.');
		const body = await readBody(c, connectBody);
		const result = await connectStripe(deps, {
			product,
			webhookUrl: body.webhook_url,
			lifetimeAmount: body.lifetime_amount,
			yearlyAmount: body.yearly_amount,
			currency: body.currency,
		});
		return c.json({ ok: true, prices: result });
	});

	app.route('/admin', admin);
}
