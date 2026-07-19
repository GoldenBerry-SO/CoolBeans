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
import {
	badRequest,
	conflict,
	notFound,
	planLimitReached,
	validationError,
} from '../../http/errors.js';
import { serializeLicense } from '../../http/serializers.js';
import { sendKeyEmail } from '../../services/email.js';
import { issueManual, trialExpiry, yearlyExpiry } from '../../services/issuance.js';
import { disableLicense, enableLicense } from '../../services/lifecycle.js';
import { enqueue } from '../../services/outbox.js';
import { planUsage, withinLimit } from '../../services/plan-limits.js';
import { accountProductIds, getProductById, listPrefixes } from '../../store/products.js';
import {
	accountScope,
	assertScope,
	auditActor,
	productScope,
	readBody,
	requireProduct,
} from './util.js';

const issueBody = z.object({
	product: z.string().min(1),
	email: z.string().email(),
	tier: z.enum(['lifetime', 'yearly', 'trial']),
	expires_at: z.string().datetime().optional(),
	trial_days: z.number().int().positive().optional(),
	note: z.string().optional(),
});

/**
 * Resolve a key to its licence within one account.
 *
 * Prefixes are matched globally, because that is how key parsing works everywhere and
 * §9 depends on it. The account check happens after, on the resolved product, and its
 * failure is the same "no license with that key" as a key that does not exist — telling
 * the two apart would confirm that a key belongs to another tenant.
 */
function resolveKey(
	deps: AppDeps,
	accountId: number,
	keyInput: string,
): { license: License; product: Product } {
	const parsed = normalizeAgainst(keyInput, listPrefixes(deps.db));
	if (!parsed) throw notFound('That key is not in a valid format.');
	const license = deps.db.select().from(licenses).where(eq(licenses.key, parsed.normalized)).get();
	if (!license) throw notFound('No license with that key.');
	const product = getProductById(deps.db, license.productId);
	if (!product || product.accountId !== accountId) throw notFound('No license with that key.');
	return { license, product };
}

export function adminLicenseView(deps: AppDeps, license: License, product: Product) {
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
	const purchase = deps.db
		.select({ email: purchases.email })
		.from(purchases)
		.where(eq(purchases.id, license.purchaseId))
		.get();
	return {
		...serializeLicense(license, product),
		id: license.id,
		normalized_key: license.key,
		disabled_reason: license.disabledReason,
		created_at: license.createdAt,
		email_sent_at: license.emailSentAt,
		live_seats: liveSeats,
		activation_limit: product.activationLimit,
		customer_email: purchase?.email ?? null,
	};
}

export function registerAdminKeyRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	admin.post('/keys', async (c) => {
		const body = await readBody(c, issueBody);
		if (body.tier === 'lifetime' && body.expires_at !== undefined) {
			throw validationError('expires_at must be omitted for a lifetime license.');
		}
		if (body.tier !== 'trial' && body.trial_days !== undefined) {
			throw validationError('trial_days is only valid for a trial license.');
		}
		if (body.tier === 'trial' && body.expires_at !== undefined && body.trial_days !== undefined) {
			throw validationError('Provide expires_at or trial_days for a trial license, not both.');
		}
		const product = requireProduct(c, deps, body.product);
		if (product.archivedAt) {
			throw conflict('product_archived', 'This product is archived and cannot issue new keys.');
		}
		// Hard refusal here, because an admin is at a keyboard and no money has moved. The
		// webhook issuance path deliberately does the opposite: see ensureLicense.
		const licences = planUsage(deps, accountScope(c)).activeLicenses;
		if (!withinLimit(licences)) {
			throw planLimitReached(
				'license_limit_reached',
				`Your plan includes ${licences.limit} active licences and you have ${licences.current}. Upgrade to Pro for unlimited licences.`,
			);
		}
		let expiresAt = body.expires_at ?? null;
		if (body.tier === 'yearly' && !expiresAt) {
			expiresAt = yearlyExpiry(deps);
		}
		if (body.tier === 'trial' && !expiresAt) {
			expiresAt = trialExpiry(deps, body.trial_days ?? 14);
		}
		const license = issueManual(deps, {
			product,
			email: body.email,
			tier: body.tier,
			expiresAt,
			note: body.note,
			actor: auditActor(c),
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
		const { license, product } = resolveKey(deps, accountScope(c).id, c.req.param('key'));
		assertScope(c, product);
		const updated = disableLicense(deps, { license, reason: 'manual', actor: auditActor(c) });
		return c.json({ ok: true, license: serializeLicense(updated, product) });
	});

	admin.post('/keys/:key/enable', (c) => {
		const { license, product } = resolveKey(deps, accountScope(c).id, c.req.param('key'));
		assertScope(c, product);
		const updated = enableLicense(deps, { license, actor: auditActor(c) });
		return c.json({ ok: true, license: serializeLicense(updated, product) });
	});

	admin.get('/keys/:key', (c) => {
		const { license, product } = resolveKey(deps, accountScope(c).id, c.req.param('key'));
		assertScope(c, product);
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
		const product = requireProduct(c, deps, c.req.param('slug'));
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
		let rows = deps.db
			.select()
			.from(purchases)
			.where(conditions.length === 1 ? conditions[0] : or(...conditions))
			.orderBy(desc(purchases.createdAt))
			.all();
		// Account first, then the narrower product-token scope inside it. The email and
		// provider_id filters are free text, so without this an admin could read any
		// tenant's purchase by guessing an address.
		const ownIds = new Set(accountProductIds(deps.db, accountScope(c).id));
		rows = rows.filter((r) => ownIds.has(r.productId));
		const scope = productScope(c);
		if (scope) rows = rows.filter((r) => r.productId === scope.id);
		return c.json({ ok: true, purchases: rows });
	});

	// A tiny endpoint to help the console show "now" alignment in tests/dev.
	admin.get('/time', (c) => c.json({ ok: true, now: nowDate(deps).toISOString() }));
}
