// ABOUTME: Admin API mount (PRD §16) — bearer-token authed product/key management + audit + signing keys.
// ABOUTME: All admin routes live under /admin behind constant-time token auth.

import { auditLog } from '@coolbeans/db';
import { OpenAPIHono } from '@hono/zod-openapi';
import { desc } from 'drizzle-orm';
import type { AppDeps } from '../../deps.js';
import { notFound } from '../../http/errors.js';
import { adminAuth } from '../../middleware/admin-auth.js';
import { rotateKey } from '../../services/signing.js';
import { getProductBySlug } from '../../store/products.js';
import { registerAdminKeyRoutes } from './keys.js';
import { registerAdminProductRoutes } from './products.js';

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

	app.route('/admin', admin);
}
