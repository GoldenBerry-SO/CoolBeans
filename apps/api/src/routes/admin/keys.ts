// ABOUTME: Admin key routes (PRD §16) — manual issue, disable/enable, listings, and key detail.
// ABOUTME: Purchase lookup by email or provider id closes the loop between payments and keys.

import type { License, Product } from '@coolbeans/db';
import { activations, licenses, metrics, products, purchases, usageCounters } from '@coolbeans/db';
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
import { issueManual, subscriptionExpiry, trialExpiry } from '../../services/issuance.js';
import { seatLimit } from '../../services/licensing.js';
import { disableLicense, enableLicense } from '../../services/lifecycle.js';
import { issueOfflineActivation } from '../../services/offline-activation.js';
import { enqueue } from '../../services/outbox.js';
import { planUsage, withinLimit } from '../../services/plan-limits.js';
import { accountProductIds, getProductById, listPrefixes } from '../../store/products.js';
import {
	accountScope,
	assertScope,
	auditActor,
	entitlementsSchema,
	productScope,
	readBody,
	requireProduct,
} from './util.js';

const offlineActivationBody = z.object({
	/** Whatever the offline machine shows the user. Opaque to us; we only bind to it. */
	fingerprint: z.string().min(1).max(200),
});

const issueBody = z.object({
	product: z.string().min(1),
	email: z.string().email(),
	kind: z.enum(['perpetual', 'subscription', 'trial']),
	plan: z.string().max(120).optional(),
	// Seats this licence gets. Omit to inherit the product's limit.
	activation_limit: z.number().int().positive().optional(),
	/**
	 * Capabilities this licence carries, e.g. { "export_4k": true }. Same rules as a grant's,
	 * because they end up in the same signed claim: flat scalars, names an app can read as a
	 * property, at most 32. A hand-issued licence has no price to inherit them from.
	 */
	entitlements: entitlementsSchema.optional(),
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
async function resolveKey(
	deps: AppDeps,
	accountId: number,
	keyInput: string,
): Promise<{ license: License; product: Product }> {
	const parsed = normalizeAgainst(keyInput, await listPrefixes(deps.db));
	if (!parsed) throw notFound('That key is not in a valid format.');
	const [license] = await deps.db
		.select()
		.from(licenses)
		.where(eq(licenses.key, parsed.normalized))
		.limit(1);
	if (!license) throw notFound('No license with that key.');
	const product = await getProductById(deps.db, license.productId);
	if (!product || product.accountId !== accountId) throw notFound('No license with that key.');
	return { license, product };
}

export async function adminLicenseView(deps: AppDeps, license: License, product: Product) {
	// A floating seat only counts while its lease is current ("expired lease frees automatically").
	const nowIso = nowDate(deps).toISOString();
	const leaseCondition =
		product.activationModel === 'floating'
			? sql`${activations.leaseExpiresAt} > ${nowIso}`
			: sql`1 = 1`;
	const liveSeats = (
		await deps.db
			.select({ id: activations.id })
			.from(activations)
			.where(
				and(
					eq(activations.licenseId, license.id),
					isNull(activations.deactivatedAt),
					leaseCondition,
				),
			)
	).length;
	const [purchase] = await deps.db
		.select({ email: purchases.email })
		.from(purchases)
		.where(eq(purchases.id, license.purchaseId))
		.limit(1);
	return {
		...serializeLicense(license, product),
		id: license.id,
		normalized_key: license.key,
		disabled_reason: license.disabledReason,
		created_at: license.createdAt,
		email_sent_at: license.emailSentAt,
		live_seats: liveSeats,
		// The licence's own snapshot when it has one, so a Pro key shows 10 seats next to a Basic
		// key's 3 on the same product.
		activation_limit: seatLimit(license, product),
		customer_email: purchase?.email ?? null,
	};
}

export function registerAdminKeyRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	admin.post('/keys', async (c) => {
		const body = await readBody(c, issueBody);
		if (body.kind === 'perpetual' && body.expires_at !== undefined) {
			throw validationError('expires_at must be omitted for a perpetual license.');
		}
		if (body.kind !== 'trial' && body.trial_days !== undefined) {
			throw validationError('trial_days is only valid for a trial license.');
		}
		if (body.kind === 'trial' && body.expires_at !== undefined && body.trial_days !== undefined) {
			throw validationError('Provide expires_at or trial_days for a trial license, not both.');
		}
		const product = await requireProduct(c, deps, body.product);
		if (product.archivedAt) {
			throw conflict('product_archived', 'This product is archived and cannot issue new keys.');
		}
		// Hard refusal here, because an admin is at a keyboard and no money has moved. The
		// webhook issuance path deliberately does the opposite: see ensureLicense.
		const licences = (await planUsage(deps, accountScope(c))).activeLicenses;
		if (!withinLimit(licences)) {
			throw planLimitReached(
				'license_limit_reached',
				`Your plan includes ${licences.limit} active licences and you have ${licences.current}. Upgrade to Pro for unlimited licences.`,
			);
		}
		let expiresAt = body.expires_at ?? null;
		if (body.kind === 'subscription' && !expiresAt) {
			expiresAt = subscriptionExpiry(deps);
		}
		if (body.kind === 'trial' && !expiresAt) {
			expiresAt = trialExpiry(deps, body.trial_days ?? 14);
		}
		const license = await issueManual(deps, {
			product,
			email: body.email,
			kind: body.kind,
			plan: body.plan,
			activationLimit: body.activation_limit ?? null,
			entitlements: body.entitlements ?? null,
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
				await enqueue(deps, 'send_key_email', { licenseId: license.id, email: body.email }, 60_000);
			}
		}
		return c.json({
			ok: true,
			license: serializeLicense(license, product),
			key: toDisplayKey(license.key, product.keyPrefix),
		});
	});

	// Air-gapped activation (issue #57). The machine never calls us: an operator pastes its
	// fingerprint here and carries the signed token back by hand.
	admin.post('/keys/:key/offline-activation', async (c) => {
		// Resolve within the account first, so a key from another tenant is 404 and not a
		// seat quietly taken on somebody else's licence.
		const { license, product } = await resolveKey(deps, accountScope(c).id, c.req.param('key'));
		// PRODUCT_SCOPED is default-deny and does not list this route, so a cbp_ token
		// never reaches here. Assert anyway: a route that mints year-long credentials
		// should not depend on an allowlist elsewhere staying correct.
		assertScope(c, product);
		const body = await readBody(c, offlineActivationBody);
		const issued = await issueOfflineActivation(deps, {
			keyInput: license.key,
			fingerprint: body.fingerprint,
			actor: auditActor(c),
		});
		return c.json({
			ok: true,
			token: issued.token,
			instance_id: issued.instanceId,
			// When the blob stops working, so the operator can tell the customer. Deliberately
			// the token's expiry rather than the licence's: the machine cannot be reached to
			// renew it, and on a lifetime licence the licence expiry is null while the token
			// still dies at the TTL.
			expires_at: issued.expiresAt,
		});
	});

	admin.post('/keys/:key/disable', async (c) => {
		const { license, product } = await resolveKey(deps, accountScope(c).id, c.req.param('key'));
		assertScope(c, product);
		const updated = await disableLicense(deps, { license, reason: 'manual', actor: auditActor(c) });
		return c.json({ ok: true, license: serializeLicense(updated, product) });
	});

	admin.post('/keys/:key/enable', async (c) => {
		const { license, product } = await resolveKey(deps, accountScope(c).id, c.req.param('key'));
		assertScope(c, product);
		const updated = await enableLicense(deps, { license, actor: auditActor(c) });
		return c.json({ ok: true, license: serializeLicense(updated, product) });
	});

	admin.get('/keys/:key', async (c) => {
		const { license, product } = await resolveKey(deps, accountScope(c).id, c.req.param('key'));
		assertScope(c, product);
		const acts = await deps.db
			.select()
			.from(activations)
			.where(eq(activations.licenseId, license.id))
			.orderBy(desc(activations.createdAt));
		const usage = await deps.db
			.select({
				metric: metrics.key,
				current: usageCounters.current,
				limitOverride: usageCounters.limitOverride,
				defaultLimit: metrics.defaultLimit,
				resetsAt: usageCounters.resetsAt,
			})
			.from(usageCounters)
			.innerJoin(metrics, eq(metrics.id, usageCounters.metricId))
			.where(eq(usageCounters.licenseId, license.id));
		return c.json({
			ok: true,
			license: await adminLicenseView(deps, license, product),
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

	admin.get('/products/:slug/keys', async (c) => {
		const product = await requireProduct(c, deps, c.req.param('slug'));
		const status = c.req.query('status');
		const emailFilter = c.req.query('email');
		const conditions = [eq(licenses.productId, product.id)];
		if (status === 'active' || status === 'disabled') {
			conditions.push(eq(licenses.status, status));
		}
		let rows = await deps.db
			.select()
			.from(licenses)
			.where(and(...conditions))
			.orderBy(desc(licenses.createdAt));
		if (emailFilter) {
			const purchaseIds = new Set(
				(
					await deps.db
						.select({ id: purchases.id })
						.from(purchases)
						.where(like(purchases.email, `%${emailFilter}%`))
				).map((p) => p.id),
			);
			rows = rows.filter((l) => purchaseIds.has(l.purchaseId));
		}
		return c.json({
			ok: true,
			keys: await Promise.all(rows.map((l) => adminLicenseView(deps, l, product))),
		});
	});

	// The account's most recent licences across every product, for the Overview card (#60).
	// Joined to products so it is account-scoped in one query and archived products still show.
	admin.get('/licenses', async (c) => {
		const accountId = accountScope(c).id;
		const requestedLimit = Number(c.req.query('limit') ?? 5);
		if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
			throw badRequest('limit must be a positive integer.');
		}
		const limit = Math.min(requestedLimit, 50);
		const rows = await deps.db
			.select()
			.from(licenses)
			.innerJoin(products, eq(products.id, licenses.productId))
			.where(eq(products.accountId, accountId))
			.orderBy(desc(licenses.createdAt))
			.limit(limit);
		return c.json({
			ok: true,
			keys: await Promise.all(rows.map((r) => adminLicenseView(deps, r.licenses, r.products))),
		});
	});

	admin.get('/purchases', async (c) => {
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
		let rows = await deps.db
			.select()
			.from(purchases)
			.where(conditions.length === 1 ? conditions[0] : or(...conditions))
			.orderBy(desc(purchases.createdAt));
		// Account first, then the narrower product-token scope inside it. The email and
		// provider_id filters are free text, so without this an admin could read any
		// tenant's purchase by guessing an address.
		const ownIds = new Set(await accountProductIds(deps.db, accountScope(c).id));
		rows = rows.filter((r) => ownIds.has(r.productId));
		const scope = productScope(c);
		if (scope) rows = rows.filter((r) => r.productId === scope.id);
		return c.json({ ok: true, purchases: rows });
	});

	// A tiny endpoint to help the console show "now" alignment in tests/dev.
	admin.get('/time', (c) => c.json({ ok: true, now: nowDate(deps).toISOString() }));
}
