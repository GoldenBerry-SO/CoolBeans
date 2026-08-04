// ABOUTME: The missed-sale rescue (pricing-UX plan phase 3) — list unfulfilled payments and
// ABOUTME: fulfill them after mapping, through the same idempotent path the webhook uses.

import { auditLog } from '@coolbeans/db';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { badRequest, notFound } from '../../http/errors.js';
import { serializeLicense } from '../../http/serializers.js';
import { findByCheckoutId } from '../../services/payments.js';
import { ensureLicenseForSession } from '../../services/stripe.js';
import { gatewayForConnection } from '../../services/stripe-connection.js';
import { getActiveConnectionForAccount } from '../../store/grants.js';
import { accountScope, readBody } from './util.js';

const rescueBody = z.object({ checkout_id: z.string().min(1) });

export function registerAdminRescueRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	// The money-taken-nothing-shipped list: every payment.unfulfilled this account has,
	// with whether a later mapping (or this rescue) already made it right.
	admin.get('/rescue/unfulfilled', async (c) => {
		// Every missed sale must stay reachable (Codex, phase-3 review): a mapping outage
		// can pile these up past any default page, so the cap is client-controllable like
		// /admin/audit's.
		const requestedLimit = Number(c.req.query('limit') ?? 50);
		if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
			throw badRequest('limit must be a positive integer.');
		}
		const rows = await deps.db
			.select()
			.from(auditLog)
			.where(
				and(eq(auditLog.accountId, accountScope(c).id), eq(auditLog.action, 'payment.unfulfilled')),
			)
			.orderBy(desc(auditLog.id))
			.limit(Math.min(requestedLimit, 500));
		const unfulfilled = [];
		for (const row of rows) {
			const detail = (row.detail ? JSON.parse(row.detail) : {}) as Record<string, unknown>;
			const checkoutId = typeof detail.checkout_id === 'string' ? detail.checkout_id : null;
			if (!checkoutId) continue;
			// Fulfilled means a purchase now exists for that checkout — whether the vendor
			// rescued it or Stripe redelivered after the mapping appeared.
			const purchase = await findByCheckoutId(deps, checkoutId);
			unfulfilled.push({
				checkout_id: checkoutId,
				email: typeof detail.email === 'string' ? detail.email : null,
				amount_total: typeof detail.amount_total === 'number' ? detail.amount_total : null,
				currency: typeof detail.currency === 'string' ? detail.currency : null,
				when: row.createdAt,
				fulfilled: Boolean(purchase),
			});
		}
		return c.json({ ok: true, unfulfilled });
	});

	// Fulfill a missed sale. Exactly the webhook's path — ensureLicenseForSession is
	// idempotent by checkout id, so a Stripe redelivery racing this rescue still issues
	// exactly one key, and re-rescuing returns the same licence.
	admin.post('/rescue/checkout', async (c) => {
		const account = accountScope(c);
		const body = await readBody(c, rescueBody);
		const connection = await getActiveConnectionForAccount(deps.db, account.id);
		if (!connection) throw badRequest('Stripe is not connected for this account yet.');
		// Fetched through the account's OWN connection: a checkout id from another tenant's
		// Stripe simply does not exist here, so cross-account rescue is a natural 404.
		const stripe = gatewayForConnection(deps, connection);
		const session = await stripe.getCheckoutSession(body.checkout_id);
		if (!session) {
			throw notFound('Stripe has no such checkout session on the connected account.');
		}
		// The scoped gateway rides INTO the ensure path (same shape as the success-page
		// route): its line-item and period-end reads must hit the connected account, not the
		// platform — or every cloud rescue reads someone else's Stripe and finds nothing
		// (Codex, phase-3 review).
		const result = await ensureLicenseForSession(
			{ ...deps, stripe },
			session,
			`rescue:${body.checkout_id}`,
			connection.id,
		);
		if (!result) {
			throw badRequest(
				'Still no price mapping covers what this checkout paid for. Map the price first, then rescue again.',
			);
		}
		return c.json({
			ok: true,
			license: serializeLicense(result.license, result.product),
		});
	});
}
