// ABOUTME: Listings behind the console's usage and webhook pages (PRD §16, issue #41).
// ABOUTME: Both pages showed permanent empty states because the data had no endpoint.

import { licenses, metrics, products, providerEvents, usageCounters } from '@coolbeans/db';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { desc, eq, isNull, or } from 'drizzle-orm';
import type { AppDeps } from '../../deps.js';
import { toDisplayKey } from '../../domain/keygen.js';
import { accountScope, isInstanceToken, productScope } from './util.js';

export function registerAdminSurfaceRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	admin.get('/usage', async (c) => {
		const accountId = accountScope(c).id;
		const scope = productScope(c);
		const rows = (
			await deps.db
				.select({
					licenseKey: licenses.key,
					keyPrefix: products.keyPrefix,
					productSlug: products.slug,
					productId: products.id,
					metric: metrics.key,
					displayName: metrics.displayName,
					current: usageCounters.current,
					limitOverride: usageCounters.limitOverride,
					defaultLimit: metrics.defaultLimit,
					resetsAt: usageCounters.resetsAt,
				})
				.from(usageCounters)
				.innerJoin(metrics, eq(metrics.id, usageCounters.metricId))
				.innerJoin(licenses, eq(licenses.id, usageCounters.licenseId))
				.innerJoin(products, eq(products.id, licenses.productId))
				.where(eq(products.accountId, accountId))
		).filter((r) => !scope || r.productId === scope.id);

		return c.json({
			ok: true,
			usage: rows.map((r) => ({
				key: toDisplayKey(r.licenseKey, r.keyPrefix),
				product: r.productSlug,
				metric: r.metric,
				display_name: r.displayName,
				current: r.current,
				limit: r.limitOverride ?? r.defaultLimit ?? null,
				resets_at: r.resetsAt,
			})),
		});
	});

	admin.get('/events', async (c) => {
		const account = accountScope(c);
		// Rows with no account are deliveries that failed before any product was resolved.
		// They are instance-level operational noise, so only an instance-wide credential
		// (self-host's ADMIN_TOKEN, which has no adminEmail) sees them.
		const instanceWide = isInstanceToken(c);
		const rows = await deps.db
			.select()
			.from(providerEvents)
			.where(
				instanceWide
					? or(eq(providerEvents.accountId, account.id), isNull(providerEvents.accountId))
					: eq(providerEvents.accountId, account.id),
			)
			.orderBy(desc(providerEvents.receivedAt), desc(providerEvents.id))
			.limit(200);
		return c.json({
			ok: true,
			events: rows.map((e) => ({
				id: e.id,
				provider: e.provider,
				type: e.type,
				status: e.status,
				received_at: e.receivedAt,
			})),
		});
	});

	admin.get('/providers', (c) => {
		// "Configured" means we hold the credentials to verify and act on a delivery,
		// which is what the console's status dot actually claims.
		return c.json({
			ok: true,
			providers: [
				{
					name: 'stripe',
					configured: Boolean(deps.config.stripe?.secretKey),
					path: '/v1/stripe/webhook',
				},
				{
					name: 'paypal',
					configured: Boolean(deps.config.paypal?.clientId),
					path: '/v1/paypal/webhook',
				},
			],
		});
	});
}
