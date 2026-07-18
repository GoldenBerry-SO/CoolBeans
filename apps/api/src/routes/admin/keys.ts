// ABOUTME: Admin key routes (PRD §16) — manual issue, disable/enable, listings, and key detail.
// ABOUTME: Purchase lookup by email or provider id closes the loop between payments and keys.

import type { License, Product } from '@coolbeans/db';
import { activations, licenses, metrics, purchases, usageCounters } from '@coolbeans/db';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { and, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { nowDate } from '../../deps.js';
import { normalizeAgainst, toDisplayKey } from '../../domain/keygen.js';
import { badRequest, notFound } from '../../http/errors.js';
import { serializeLicense } from '../../http/serializers.js';
import { sendKeyEmail } from '../../services/email.js';
import { issueManual, trialExpiry } from '../../services/issuance.js';
import { disableLicense, enableLicense } from '../../services/lifecycle.js';
import { enqueue } from '../../services/outbox.js';
import { getProductById, getProductBySlug, listPrefixes } from '../../store/products.js';
import { readBody } from './util.js';

const issueBody = z.object({
	product: z.string().min(1),
	email: z.string().email(),
	tier: z.enum(['lifetime', 'yearly', 'trial']),
	expires_at: z.string().datetime().optional(),
	trial_days: z.number().int().positive().optional(),
	note: z.string().optional(),
});

function resolveKey(deps: AppDeps, keyInput: string): { license: License; product: Product } {
	const parsed = normalizeAgainst(keyInput, listPrefixes(deps.db));
	if (!parsed) throw notFound('That key is not in a valid format.');
	const license = deps.db.select().from(licenses).where(eq(licenses.key, parsed.normalized)).get();
	if (!license) throw notFound('No license with that key.');
	const product = getProductById(deps.db, license.productId);
	if (!product) throw notFound('No license with that key.');
	return { license, product };
}

function adminLicenseView(deps: AppDeps, license: License, product: Product) {
	// A floating seat only counts while its lease is current ("expired lease frees automatically").
	const nowIso = nowDate(deps).toISOString();
	const leaseCondition =
		product.activationModel === 'floating'
			? sql`${activations.leaseExpiresAt} > ${nowIso}`
			: sql`1 = 1`;
	const liveSeats = deps.db
		.select({ id: activations.id })
		.from(activations)
		.where(
			and(eq(activations.licenseId, license.id), isNull(activations.deactivatedAt), leaseCondition),
		)
		.all().length;
	return {
		...serializeLicense(license, product),
		id: license.id,
		normalized_key: license.key,
		disabled_reason: license.disabledReason,
		created_at: license.createdAt,
		email_sent_at: license.emailSentAt,
		live_seats: liveSeats,
		activation_limit: product.activationLimit,
	};
}

export function registerAdminKeyRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	admin.post('/keys', async (c) => {
		const body = await readBody(c, issueBody);
		const product = getProductBySlug(deps.db, body.product);
		if (!product) throw notFound(`No product with slug "${body.product}".`);
		let expiresAt = body.expires_at ?? null;
		if (body.tier === 'trial' && !expiresAt) {
			expiresAt = trialExpiry(deps, body.trial_days ?? 14);
		}
		const license = issueManual(deps, {
			product,
			email: body.email,
			tier: body.tier,
			expiresAt,
			note: body.note,
			actor: 'admin',
		});
		// Deliver the key email like any purchase (PRD §14). A send failure never fails
		// the issuance: the durable outbox retries it.
		if (deps.email) {
			try {
				await sendKeyEmail(deps, { license, product, email: body.email });
			} catch {
				enqueue(deps, 'send_key_email', { licenseId: license.id, email: body.email }, 60_000);
			}
		}
		return c.json({
			ok: true,
			license: serializeLicense(license, product),
			key: toDisplayKey(license.key, product.keyPrefix),
		});
	});

	admin.post('/keys/:key/disable', (c) => {
		const { license, product } = resolveKey(deps, c.req.param('key'));
		const updated = disableLicense(deps, { license, reason: 'manual', actor: 'admin' });
		return c.json({ ok: true, license: serializeLicense(updated, product) });
	});

	admin.post('/keys/:key/enable', (c) => {
		const { license, product } = resolveKey(deps, c.req.param('key'));
		const updated = enableLicense(deps, { license, actor: 'admin' });
		return c.json({ ok: true, license: serializeLicense(updated, product) });
	});

	admin.get('/keys/:key', (c) => {
		const { license, product } = resolveKey(deps, c.req.param('key'));
		const acts = deps.db
			.select()
			.from(activations)
			.where(eq(activations.licenseId, license.id))
			.orderBy(desc(activations.createdAt))
			.all();
		const usage = deps.db
			.select({
				metric: metrics.key,
				current: usageCounters.current,
				limitOverride: usageCounters.limitOverride,
				defaultLimit: metrics.defaultLimit,
				resetsAt: usageCounters.resetsAt,
			})
			.from(usageCounters)
			.innerJoin(metrics, eq(metrics.id, usageCounters.metricId))
			.where(eq(usageCounters.licenseId, license.id))
			.all();
		return c.json({
			ok: true,
			license: adminLicenseView(deps, license, product),
			activations: acts.map((a) => ({
				instance_id: a.instanceId,
				name: a.name,
				created_at: a.createdAt,
				last_validated_at: a.lastValidatedAt,
				lease_expires_at: a.leaseExpiresAt,
				deactivated_at: a.deactivatedAt,
			})),
			usage: usage.map((u) => ({
				metric: u.metric,
				current: u.current,
				limit: u.limitOverride ?? u.defaultLimit ?? null,
				resets_at: u.resetsAt,
			})),
		});
	});

	admin.get('/products/:slug/keys', (c) => {
		const product = getProductBySlug(deps.db, c.req.param('slug'));
		if (!product) throw notFound('No product with that slug.');
		const status = c.req.query('status');
		const emailFilter = c.req.query('email');
		const conditions = [eq(licenses.productId, product.id)];
		if (status === 'active' || status === 'disabled') {
			conditions.push(eq(licenses.status, status));
		}
		let rows = deps.db
			.select()
			.from(licenses)
			.where(and(...conditions))
			.orderBy(desc(licenses.createdAt))
			.all();
		if (emailFilter) {
			const purchaseIds = new Set(
				deps.db
					.select({ id: purchases.id })
					.from(purchases)
					.where(like(purchases.email, `%${emailFilter}%`))
					.all()
					.map((p) => p.id),
			);
			rows = rows.filter((l) => purchaseIds.has(l.purchaseId));
		}
		return c.json({
			ok: true,
			keys: rows.map((l) => adminLicenseView(deps, l, product)),
		});
	});

	admin.get('/purchases', (c) => {
		const email = c.req.query('email');
		const providerId = c.req.query('provider_id');
		if (!email && !providerId) throw badRequest('Provide email or provider_id.');
		const conditions = [];
		if (email) conditions.push(like(purchases.email, `%${email}%`));
		if (providerId) {
			conditions.push(
				or(
					eq(purchases.providerCheckoutId, providerId),
					eq(purchases.providerSubscriptionId, providerId),
					eq(purchases.providerPaymentId, providerId),
				),
			);
		}
		const rows = deps.db
			.select()
			.from(purchases)
			.where(conditions.length === 1 ? conditions[0] : or(...conditions))
			.orderBy(desc(purchases.createdAt))
			.all();
		return c.json({ ok: true, purchases: rows });
	});

	// A tiny endpoint to help the console show "now" alignment in tests/dev.
	admin.get('/time', (c) => c.json({ ok: true, now: nowDate(deps).toISOString() }));
}
