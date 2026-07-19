// ABOUTME: Admin product routes (PRD §16) — create/update products and define metered metrics.
// ABOUTME: Bearer-token authed upstream; uniqueness violations surface as the uniform envelope.

import { licenses, metrics, products } from '@coolbeans/db';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { nowDate } from '../../deps.js';
import { badRequest, conflict } from '../../http/errors.js';
import { issueProductToken } from '../../services/product-tokens.js';
import { writeAudit } from '../../store/audit.js';
import { isUniqueConstraintError } from '../../store/db-errors.js';
import { getProductBySlugGlobal, listAccountProducts } from '../../store/products.js';
import { accountScope, auditActor, productScope, readBody, requireProduct } from './util.js';

const createProductBody = z.object({
	slug: z
		.string()
		.min(1)
		.regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and dashes'),
	name: z.string().min(1),
	// Bounds match the public format gate (looksLikeKey, PRD §10): a prefix outside
	// 2–12 letters would issue keys every public endpoint rejects as invalid_key.
	key_prefix: z
		.string()
		.min(2, 'key_prefix must be 2-12 letters')
		.max(12, 'key_prefix must be 2-12 letters')
		.regex(/^[A-Za-z]+$/, 'key_prefix must be letters only'),
	activation_limit: z.number().int().positive().optional(),
	activation_model: z.enum(['node_locked', 'floating']).optional(),
	floating_lease_minutes: z.number().int().positive().optional(),
	email_from: z.string().min(1),
	download_url: z.string().url().optional(),
	stripe_price_lifetime: z.string().optional(),
	stripe_price_yearly: z.string().optional(),
	stripe_webhook_secret: z.string().optional(),
	paypal_plan_yearly: z.string().optional(),
	paypal_sku_lifetime: z.string().optional(),
	archived: z.boolean().optional(),
});

const metricBody = z.object({
	key: z.string().min(1),
	display_name: z.string().min(1),
	default_limit: z.number().int().nonnegative().optional(),
	reset_period: z.enum(['daily', 'monthly']).optional(),
});

export function registerAdminProductRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	admin.post('/products', async (c) => {
		const account = accountScope(c);
		const body = await readBody(c, createProductBody);
		// Global on purpose: slug and key_prefix are unique across the instance because
		// both appear in public URLs. The message deliberately does not say which account
		// holds it, so this cannot be used to enumerate other tenants.
		if (getProductBySlugGlobal(deps.db, body.slug)) {
			throw conflict('product_exists', `A product with slug "${body.slug}" already exists.`);
		}
		try {
			const product = deps.db
				.insert(products)
				.values({
					accountId: account.id,
					slug: body.slug,
					name: body.name,
					keyPrefix: body.key_prefix.toUpperCase(),
					activationLimit: body.activation_limit ?? 3,
					activationModel: body.activation_model ?? 'node_locked',
					floatingLeaseMinutes: body.floating_lease_minutes ?? 30,
					emailFrom: body.email_from,
					downloadUrl: body.download_url ?? null,
					stripePriceLifetime: body.stripe_price_lifetime ?? null,
					stripePriceYearly: body.stripe_price_yearly ?? null,
					stripeWebhookSecret: body.stripe_webhook_secret ?? null,
					paypalPlanYearly: body.paypal_plan_yearly ?? null,
					paypalSkuLifetime: body.paypal_sku_lifetime ?? null,
				})
				.returning()
				.get();
			writeAudit(deps.db, {
				action: 'product.created',
				actor: auditActor(c),
				accountId: account.id,
				productId: product.id,
				detail: { slug: product.slug, prefix: product.keyPrefix },
			});
			// The per-product token (success-page scope) is returned ONCE; only its hash is stored.
			const productToken = issueProductToken(deps, product);
			return c.json({ ok: true, product, product_token: productToken });
		} catch (err) {
			if (isUniqueConstraintError(err)) {
				throw conflict('prefix_taken', 'That slug or key prefix is already in use.');
			}
			throw err;
		}
	});

	admin.patch('/products/:slug', async (c) => {
		const product = requireProduct(c, deps, c.req.param('slug'));
		const body = await readBody(c, createProductBody.partial());
		// slug and key_prefix are immutable: issued keys embed the prefix and clients
		// resolve products by it. Reject rather than silently ignoring.
		if (body.slug !== undefined || body.key_prefix !== undefined) {
			throw badRequest('slug and key_prefix cannot be changed after creation.');
		}
		const patch: Record<string, unknown> = {};
		if (body.name !== undefined) patch.name = body.name;
		if (body.activation_limit !== undefined) patch.activationLimit = body.activation_limit;
		if (body.activation_model !== undefined) patch.activationModel = body.activation_model;
		if (body.floating_lease_minutes !== undefined)
			patch.floatingLeaseMinutes = body.floating_lease_minutes;
		if (body.email_from !== undefined) patch.emailFrom = body.email_from;
		if (body.download_url !== undefined) patch.downloadUrl = body.download_url;
		if (body.stripe_price_lifetime !== undefined)
			patch.stripePriceLifetime = body.stripe_price_lifetime;
		if (body.stripe_price_yearly !== undefined) patch.stripePriceYearly = body.stripe_price_yearly;
		if (body.stripe_webhook_secret !== undefined)
			patch.stripeWebhookSecret = body.stripe_webhook_secret;
		if (body.paypal_plan_yearly !== undefined) patch.paypalPlanYearly = body.paypal_plan_yearly;
		if (body.paypal_sku_lifetime !== undefined) patch.paypalSkuLifetime = body.paypal_sku_lifetime;
		if (body.archived !== undefined)
			patch.archivedAt = body.archived ? nowDate(deps).toISOString() : null;
		if (Object.keys(patch).length === 0) throw badRequest('No updatable fields provided.');
		const updated = deps.db
			.update(products)
			.set(patch)
			.where(eq(products.id, product.id))
			.returning()
			.get();
		writeAudit(deps.db, {
			action: 'product.updated',
			actor: auditActor(c),
			accountId: product.accountId,
			productId: product.id,
			detail: { fields: Object.keys(patch) },
		});
		return c.json({ ok: true, product: updated });
	});

	admin.get('/products', (c) => {
		const account = accountScope(c);
		// List rows go to the console/CLI; secrets stay server-side (the :slug endpoint
		// still returns the full row for operational tooling).
		const scope = productScope(c);
		const includeArchived = c.req.query('include_archived') === '1';
		const visible = listAccountProducts(deps.db, account.id)
			.filter((p) => !scope || p.id === scope.id)
			.filter((p) => includeArchived || !p.archivedAt);
		// The console's product cards show key counts; one grouped pass covers them, and
		// the id filter keeps another account's licences out of the totals.
		const visibleIds = new Set(visible.map((p) => p.id));
		const counts = new Map<number, { total: number; active: number }>();
		for (const row of deps.db
			.select({ productId: licenses.productId, status: licenses.status })
			.from(licenses)
			.all()) {
			if (!visibleIds.has(row.productId)) continue;
			const entry = counts.get(row.productId) ?? { total: 0, active: 0 };
			entry.total += 1;
			if (row.status === 'active') entry.active += 1;
			counts.set(row.productId, entry);
		}
		return c.json({
			ok: true,
			products: visible.map(({ stripeWebhookSecret: _secret, productTokenHash: _hash, ...p }) => ({
				...p,
				keysTotal: counts.get(p.id)?.total ?? 0,
				keysActive: counts.get(p.id)?.active ?? 0,
			})),
		});
	});

	admin.delete('/products/:slug', (c) => {
		const product = requireProduct(c, deps, c.req.param('slug'));
		// Archive, never delete: §9 promises issued keys keep validating. This only
		// stops new issuance and hides the product from the console's default list.
		deps.db
			.update(products)
			.set({ archivedAt: nowDate(deps).toISOString() })
			.where(eq(products.id, product.id))
			.run();
		writeAudit(deps.db, {
			action: 'product.archived',
			actor: auditActor(c),
			accountId: product.accountId,
			productId: product.id,
		});
		return c.json({ ok: true });
	});

	admin.get('/products/:slug', (c) => {
		return c.json({ ok: true, product: requireProduct(c, deps, c.req.param('slug')) });
	});

	admin.post('/products/:slug/metrics', async (c) => {
		const product = requireProduct(c, deps, c.req.param('slug'));
		const body = await readBody(c, metricBody);
		const existing = deps.db
			.select({ id: metrics.id })
			.from(metrics)
			.where(and(eq(metrics.productId, product.id), eq(metrics.key, body.key)))
			.get();
		if (existing) {
			throw conflict('metric_exists', `A metric "${body.key}" already exists for this product.`);
		}
		const metric = deps.db
			.insert(metrics)
			.values({
				productId: product.id,
				key: body.key,
				displayName: body.display_name,
				defaultLimit: body.default_limit ?? null,
				resetPeriod: body.reset_period ?? null,
			})
			.returning()
			.get();
		writeAudit(deps.db, {
			action: 'metric.created',
			actor: auditActor(c),
			accountId: product.accountId,
			productId: product.id,
			detail: { key: metric.key, default_limit: metric.defaultLimit },
		});
		return c.json({ ok: true, metric });
	});
}
