// ABOUTME: Admin product routes (PRD §16) — create/update products and define metered metrics.
// ABOUTME: Bearer-token authed upstream; uniqueness violations surface as the uniform envelope.

import { metrics, products } from '@coolbeans/db';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { writeAudit } from '../../store/audit.js';
import { getProductBySlug, listProducts } from '../../store/products.js';
import { readBody } from './util.js';

const createProductBody = z.object({
	slug: z
		.string()
		.min(1)
		.regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and dashes'),
	name: z.string().min(1),
	key_prefix: z
		.string()
		.min(1)
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
});

const metricBody = z.object({
	key: z.string().min(1),
	display_name: z.string().min(1),
	default_limit: z.number().int().nonnegative().optional(),
	reset_period: z.enum(['daily', 'monthly']).optional(),
});

export function registerAdminProductRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	admin.post('/products', async (c) => {
		const body = await readBody(c, createProductBody);
		if (getProductBySlug(deps.db, body.slug)) {
			throw conflict('product_exists', `A product with slug "${body.slug}" already exists.`);
		}
		try {
			const product = deps.db
				.insert(products)
				.values({
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
				actor: 'admin',
				productId: product.id,
				detail: { slug: product.slug, prefix: product.keyPrefix },
			});
			return c.json({ ok: true, product });
		} catch (err) {
			if (err instanceof Error && /UNIQUE/i.test(err.message)) {
				throw conflict('prefix_taken', 'That slug or key prefix is already in use.');
			}
			throw err;
		}
	});

	admin.patch('/products/:slug', async (c) => {
		const product = getProductBySlug(deps.db, c.req.param('slug'));
		if (!product) throw notFound('No product with that slug.');
		const body = await readBody(c, createProductBody.partial());
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
		if (Object.keys(patch).length === 0) throw badRequest('No updatable fields provided.');
		const updated = deps.db
			.update(products)
			.set(patch)
			.where(eq(products.id, product.id))
			.returning()
			.get();
		writeAudit(deps.db, {
			action: 'product.updated',
			actor: 'admin',
			productId: product.id,
			detail: { fields: Object.keys(patch) },
		});
		return c.json({ ok: true, product: updated });
	});

	admin.get('/products', (c) => c.json({ ok: true, products: listProducts(deps.db) }));

	admin.get('/products/:slug', (c) => {
		const product = getProductBySlug(deps.db, c.req.param('slug'));
		if (!product) throw notFound('No product with that slug.');
		return c.json({ ok: true, product });
	});

	admin.post('/products/:slug/metrics', async (c) => {
		const product = getProductBySlug(deps.db, c.req.param('slug'));
		if (!product) throw notFound('No product with that slug.');
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
		return c.json({ ok: true, metric });
	});
}
