// ABOUTME: Customer portal API (PRD §15) — key-authed self-service lookup and seat management.
// ABOUTME: The key is the credential; a buyer sees their license + devices and can free a seat.

import { activations, licenses, products, purchases } from '@coolbeans/db';
import { KeyRecoveryEmail, render } from '@coolbeans/email';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { nowDate } from '../../deps.js';
import { toDisplayKey } from '../../domain/keygen.js';
import { ApiError, badRequest } from '../../http/errors.js';
import { serializeLicense } from '../../http/serializers.js';
import { resolveEmailIdentity } from '../../services/email.js';
import { resolveLicense } from '../../services/licensing.js';

const lookupBody = z.object({ license_key: z.string() });
const recoverBody = z.object({ email: z.string().email() });
const billingBody = z.object({ license_key: z.string(), return_url: z.string().url().optional() });

async function readJson<T>(
	c: { req: { json: () => Promise<unknown> } },
	schema: z.ZodType<T>,
	message: string,
): Promise<T> {
	let raw: unknown;
	try {
		raw = await c.req.json();
	} catch {
		throw badRequest('Request body must be valid JSON.');
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) throw badRequest(message);
	return parsed.data;
}

export function registerPortalRoutes(app: OpenAPIHono, deps: AppDeps): void {
	// Look up a license by its key and list live devices. Key is the credential (no login).
	app.post('/v1/portal/lookup', async (c) => {
		let raw: unknown;
		try {
			raw = await c.req.json();
		} catch {
			throw badRequest('Request body must be valid JSON.');
		}
		const parsed = lookupBody.safeParse(raw);
		if (!parsed.success) throw badRequest('A license_key is required.');
		const resolved = await resolveLicense(deps, parsed.data.license_key);
		const nowIso = nowDate(deps).toISOString();
		const leaseCondition =
			resolved.product.activationModel === 'floating'
				? sql`${activations.leaseExpiresAt} > ${nowIso}`
				: sql`1 = 1`;
		const devices = await deps.db
			.select()
			.from(activations)
			.where(
				and(
					eq(activations.licenseId, resolved.license.id),
					isNull(activations.deactivatedAt),
					leaseCondition,
				),
			)
			.orderBy(desc(activations.createdAt));
		return c.json({
			ok: true,
			license: serializeLicense(resolved.license, resolved.product, resolved.status),
			download_url: resolved.product.downloadUrl ?? null,
			activations: devices.map((d) => ({
				instance_id: d.instanceId,
				name: d.name,
				created_at: d.createdAt,
				last_validated_at: d.lastValidatedAt,
			})),
		});
	});

	/**
	 * Recover keys by email (§15). The keys are EMAILED, never returned: an email
	 * address is not a credential, so answering directly would hand anyone who knows
	 * a buyer's address their licenses. The response is identical either way so this
	 * cannot be used to probe who bought what.
	 */
	app.post('/v1/portal/recover', async (c) => {
		const body = await readJson(c, recoverBody, 'A valid email is required.');
		const email = body.email.trim().toLowerCase();
		const uniform = {
			ok: true as const,
			message: 'If we have licenses for that email, they are on their way.',
		};

		const rows = await deps.db
			.select({ license: licenses, product: products })
			.from(licenses)
			.innerJoin(purchases, eq(purchases.id, licenses.purchaseId))
			.innerJoin(products, eq(products.id, licenses.productId))
			.where(eq(sql`lower(${purchases.email})`, email));
		if (rows.length === 0 || !deps.email) return c.json(uniform);

		// Rendering AND sending both happen after the response. An unknown address returns
		// immediately, so any work done before responding here — the render included — is
		// measurable and turns response time into a "did this person buy?" oracle.
		// Failures are logged rather than surfaced, for the same reason.
		const sender = deps.email;
		void (async () => {
			try {
				const html = await render(
					KeyRecoveryEmail({
						keys: rows.map((r) => ({
							key: toDisplayKey(r.license.key, r.product.keyPrefix),
							product: r.product.name,
							status: r.license.status,
						})),
						logoUrl: `${deps.config.publicUrl}/logo.png`,
					}),
				);
				await sender.send({
					...resolveEmailIdentity(deps.config, rows[0].product.emailFrom),
					to: body.email,
					subject: 'Your Cool Beans license keys',
					html,
				});
			} catch (err) {
				deps.logger.error('Portal recovery email failed', { message: (err as Error).message });
			}
		})();
		return c.json(uniform);
	});

	/** A provider billing-portal URL so a subscriber can manage or cancel (§15). */
	app.post('/v1/portal/billing-session', async (c) => {
		const body = await readJson(c, billingBody, 'A license_key is required.');
		const resolved = await resolveLicense(deps, body.license_key);
		const [purchase] = await deps.db
			.select()
			.from(purchases)
			.where(eq(purchases.id, resolved.license.purchaseId))
			.limit(1);
		const customerId = purchase?.providerCustomerId;
		// A lifetime Stripe checkout also has a customer id, so the customer alone is not
		// enough: without a subscription there is genuinely nothing to manage, and sending
		// them to a billing portal would be a dead end.
		const hasSubscription =
			Boolean(purchase?.providerSubscriptionId) || resolved.license.tier === 'yearly';
		if (
			!purchase ||
			!customerId ||
			!hasSubscription ||
			purchase.provider !== 'stripe' ||
			!deps.stripe
		) {
			// Lifetime and manually issued keys have nothing to manage; say so plainly.
			throw new ApiError(
				404,
				'no_billing_account',
				'There is no subscription to manage for this license.',
			);
		}
		const url = await deps.stripe.billingPortalSession(
			customerId,
			body.return_url ?? deps.config.publicUrl,
		);
		return c.json({ ok: true, url });
	});
}
