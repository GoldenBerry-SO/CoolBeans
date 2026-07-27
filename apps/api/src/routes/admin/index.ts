// ABOUTME: Admin API mount (PRD §16) — bearer-token authed product/key management + audit + signing keys.
// ABOUTME: All admin routes live under /admin behind constant-time token auth.

import { auditLog, rowsOf } from '@coolbeans/db';
import { OpenAPIHono } from '@hono/zod-openapi';
import { desc, eq, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { badRequest } from '../../http/errors.js';
import { consoleAuth } from '../../middleware/console-auth.js';
import { issueProductToken } from '../../services/product-tokens.js';
import { rotateKey } from '../../services/signing.js';
import { connectStripe } from '../../services/stripe-connect.js';
import { startConnectAuthorization } from '../../services/stripe-onboarding.js';
import { recentValidationCounts } from '../../services/validation-stats.js';
import { writeAudit } from '../../store/audit.js';
import { accountProductIds } from '../../store/products.js';
import { registerAdminBillingRoutes } from './billing.js';
import { registerAdminExportRoutes } from './export.js';
import { registerAdminGrantRoutes } from './grants.js';
import { registerAdminKeyRoutes } from './keys.js';
import { registerAdminProductRoutes } from './products.js';
import { registerAdminSurfaceRoutes } from './surfaces.js';
import { registerAdminTeamRoutes } from './team.js';
import { accountScope, auditActor, readBody, requireProduct } from './util.js';

export function registerAdminRoutes(app: OpenAPIHono, deps: AppDeps): void {
	const admin = new OpenAPIHono();
	admin.use('*', consoleAuth(deps));

	registerAdminBillingRoutes(admin, deps);
	registerAdminProductRoutes(admin, deps);
	registerAdminGrantRoutes(admin, deps);
	registerAdminKeyRoutes(admin, deps);
	registerAdminExportRoutes(admin, deps);
	registerAdminTeamRoutes(admin, deps);
	registerAdminSurfaceRoutes(admin, deps);

	// Raw SQL, so it sidesteps every store helper and type-level guard in the scoping
	// layer. Each count therefore has to carry its own account filter — licences and
	// activations reach it by joining back through products.
	admin.get('/stats', async (c) => {
		const accountId = accountScope(c).id;
		// COUNT(*) is bigint, which the driver hands back as a string to avoid losing
		// precision. Number() here keeps the JSON shape these counts have always had.
		// rowsOf, not destructuring: a raw execute is an array on postgres-js and an
		// object on PGlite, and destructuring the wrong one is a 500 only one side sees.
		const count = async (statement: SQL) => {
			const [row] = rowsOf<{ n: number | string }>(await deps.db.execute(statement));
			return Number(row.n);
		};
		return c.json({
			ok: true,
			stats: {
				products: await count(sql`SELECT COUNT(*) n FROM products WHERE account_id = ${accountId}`),
				active_licenses: await count(
					sql`SELECT COUNT(*) n FROM licenses l JOIN products p ON p.id = l.product_id WHERE p.account_id = ${accountId} AND l.status = 'active'`,
				),
				total_licenses: await count(
					sql`SELECT COUNT(*) n FROM licenses l JOIN products p ON p.id = l.product_id WHERE p.account_id = ${accountId}`,
				),
				live_activations: await count(
					sql`SELECT COUNT(*) n FROM activations a JOIN licenses l ON l.id = a.license_id JOIN products p ON p.id = l.product_id WHERE p.account_id = ${accountId} AND a.deactivated_at IS NULL`,
				),
			},
		});
	});

	// Validation traffic for the Overview chart (issue #37). Sixteen days to match the
	// design; missing days come back as zero so the chart never has holes in it.
	admin.get('/validations', async (c) => {
		const accountId = accountScope(c).id;
		const productSlug = c.req.query('product');
		const product = productSlug ? await requireProduct(c, deps, productSlug) : undefined;
		return c.json({
			ok: true,
			validations: await recentValidationCounts(deps, {
				days: 16,
				productId: product?.id,
				// With no slug the chart covers the whole account, which means every product
				// it owns and no one else's.
				...(product ? {} : { productIds: await accountProductIds(deps.db, accountId) }),
			}),
		});
	});

	admin.get('/audit', async (c) => {
		const requestedLimit = Number(c.req.query('limit') ?? 100);
		if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
			throw badRequest('limit must be a positive integer.');
		}
		const limit = Math.min(requestedLimit, 500);
		const rows = await deps.db
			.select()
			.from(auditLog)
			.where(eq(auditLog.accountId, accountScope(c).id))
			.orderBy(desc(auditLog.id))
			.limit(limit);
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

	admin.post('/products/:slug/signing-keys/rotate', async (c) => {
		const product = await requireProduct(c, deps, c.req.param('slug'));
		const key = await rotateKey(deps, product.id);
		await writeAudit(deps.db, {
			action: 'signing_key.rotated',
			actor: auditActor(c),
			accountId: product.accountId,
			productId: product.id,
			detail: { kid: String(key.id) },
		});
		return c.json({ ok: true, signing_key: { kid: String(key.id), public_key: key.publicKey } });
	});

	// Rotate the per-product token (success-page scope). The plaintext is returned ONCE.
	admin.post('/products/:slug/token/rotate', async (c) => {
		// This one never called assertScope. It was covered by the PRODUCT_SCOPED
		// allowlist rather than by the handler defending itself; requireProduct closes
		// both the account and the product-token hole in one call.
		const product = await requireProduct(c, deps, c.req.param('slug'));
		return c.json({
			ok: true,
			product_token: await issueProductToken(deps, product, auditActor(c)),
		});
	});

	// Webhook registration only. The two price fields the old body carried are refused by name
	// rather than silently stripped: an operator pasting the old shape would otherwise believe
	// two prices were mapped when nothing happened. Prices are mapped in the grants API.
	const connectBody = z
		.object({ webhook_url: z.string().url() })
		.catchall(z.unknown())
		.superRefine((body, ctx) => {
			for (const field of ['lifetime_price_id', 'yearly_price_id']) {
				if (field in body) {
					ctx.addIssue({
						code: 'custom',
						path: [field],
						message:
							'Connect registers the webhook only now. Map prices with the grants API (POST /admin/products/:slug/grants).',
					});
				}
			}
		});
	admin.post('/products/:slug/stripe/connect', async (c) => {
		const product = await requireProduct(c, deps, c.req.param('slug'));
		const body = await readBody(c, connectBody);
		const result = await connectStripe(deps, {
			actor: auditActor(c),
			product,
			webhookUrl: body.webhook_url,
		});
		return c.json({
			ok: true,
			webhook_path: result.webhookPath,
			secret_rotated: result.secretRotated,
			dunning: result.dunning,
			...(result.note ? { note: result.note } : {}),
		});
	});

	// Cloud onboarding: hand the vendor a Stripe URL to authorize their own account. The
	// state minted here is what binds the callback back to this account, so this endpoint has
	// to be authenticated even though the callback cannot be.
	admin.post('/stripe/connect/authorize', async (c) => {
		const account = accountScope(c);
		const { url } = await startConnectAuthorization(deps, { accountId: account.id });
		await writeAudit(deps.db, {
			action: 'stripe.connect_authorization_started',
			actor: auditActor(c),
			accountId: account.id,
		});
		return c.json({ ok: true, url });
	});

	app.route('/admin', admin);
}
