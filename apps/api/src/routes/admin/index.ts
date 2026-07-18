// ABOUTME: Admin API mount (PRD §16) — bearer-token authed product/key management + audit + signing keys.
// ABOUTME: All admin routes live under /admin behind constant-time token auth.

import { auditLog } from '@coolbeans/db';
import { OpenAPIHono } from '@hono/zod-openapi';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { notFound } from '../../http/errors.js';
import { consoleAuth } from '../../middleware/console-auth.js';
import { issueProductToken } from '../../services/product-tokens.js';
import { rotateKey } from '../../services/signing.js';
import { connectStripe } from '../../services/stripe-connect.js';
import { recentValidationCounts } from '../../services/validation-stats.js';
import { writeAudit } from '../../store/audit.js';
import { getProductBySlug } from '../../store/products.js';
import { registerAdminKeyRoutes } from './keys.js';
import { registerAdminProductRoutes } from './products.js';
import { registerAdminSurfaceRoutes } from './surfaces.js';
import { registerAdminTeamRoutes } from './team.js';
import { assertScope, auditActor, readBody } from './util.js';

export function registerAdminRoutes(app: OpenAPIHono, deps: AppDeps): void {
	const admin = new OpenAPIHono();
	admin.use('*', consoleAuth(deps));

	registerAdminProductRoutes(admin, deps);
	registerAdminKeyRoutes(admin, deps);
	registerAdminTeamRoutes(admin, deps);
	registerAdminSurfaceRoutes(admin, deps);

	admin.get('/stats', (c) => {
		const count = (sqlText: string) => (deps.db.$client.prepare(sqlText).get() as { n: number }).n;
		return c.json({
			ok: true,
			stats: {
				products: count('SELECT COUNT(*) n FROM products'),
				active_licenses: count("SELECT COUNT(*) n FROM licenses WHERE status = 'active'"),
				total_licenses: count('SELECT COUNT(*) n FROM licenses'),
				live_activations: count('SELECT COUNT(*) n FROM activations WHERE deactivated_at IS NULL'),
			},
		});
	});

	// Validation traffic for the Overview chart (issue #37). Sixteen days to match the
	// design; missing days come back as zero so the chart never has holes in it.
	admin.get('/validations', (c) => {
		const productSlug = c.req.query('product');
		const product = productSlug ? getProductBySlug(deps.db, productSlug) : undefined;
		if (productSlug && !product) throw notFound('No product with that slug.');
		return c.json({
			ok: true,
			validations: recentValidationCounts(deps, { days: 16, productId: product?.id }),
		});
	});

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
		assertScope(c, product);
		const key = rotateKey(deps, product.id);
		writeAudit(deps.db, {
			action: 'signing_key.rotated',
			actor: auditActor(c),
			productId: product.id,
			detail: { kid: String(key.id) },
		});
		return c.json({ ok: true, signing_key: { kid: String(key.id), public_key: key.publicKey } });
	});

	// Rotate the per-product token (success-page scope). The plaintext is returned ONCE.
	admin.post('/products/:slug/token/rotate', (c) => {
		const product = getProductBySlug(deps.db, c.req.param('slug'));
		if (!product) throw notFound('No product with that slug.');
		return c.json({ ok: true, product_token: issueProductToken(deps, product, auditActor(c)) });
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
		assertScope(c, product);
		const body = await readBody(c, connectBody);
		const result = await connectStripe(deps, {
			actor: auditActor(c),
			product,
			webhookUrl: body.webhook_url,
			lifetimeAmount: body.lifetime_amount,
			yearlyAmount: body.yearly_amount,
			currency: body.currency,
		});
		return c.json({
			ok: true,
			prices: { lifetimePriceId: result.lifetimePriceId, yearlyPriceId: result.yearlyPriceId },
			webhook_path: result.webhookPath,
			secret_rotated: result.secretRotated,
			dunning: result.dunning,
		});
	});

	app.route('/admin', admin);
}
