// ABOUTME: The Stripe Connect webhook (issue #62 cloud) — one platform endpoint for every vendor.
// ABOUTME: Verified with the platform secret, routed to a connection by the signed event.account.

import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppDeps } from '../../deps.js';
import { handleStripeEvent } from '../../services/stripe.js';
import { disconnectConnection } from '../../services/stripe-connection.js';
import { writeAudit } from '../../store/audit.js';
import { getConnectionByStripeAccount } from '../../store/grants.js';

/** The connected account an event came from. Present on every Connect delivery. */
function eventAccount(event: unknown): string | null {
	const acct = (event as { account?: unknown }).account;
	return typeof acct === 'string' && acct !== '' ? acct : null;
}

export function registerConnectWebhook(app: OpenAPIHono, deps: AppDeps): void {
	app.post('/v1/connect/stripe/webhook', async (c) => {
		// The platform gateway verifies with the platform Connect secret. One secret verifies
		// every connected account's events, so this is the only endpoint cloud vendors point at.
		const gateway = deps.connect;
		const secret = deps.config.connect?.webhookSecret;
		if (!gateway || !secret) {
			return c.json(
				{
					ok: false,
					error: 'connect_not_configured',
					message: 'Stripe Connect is not configured.',
				},
				503,
			);
		}
		const signature = c.req.header('stripe-signature');
		if (!signature) {
			return c.json(
				{
					ok: false,
					error: 'missing_signature',
					message: 'A Stripe signature header is required.',
				},
				400,
			);
		}
		const rawBody = await c.req.text();
		let event: ReturnType<NonNullable<AppDeps['connect']>['constructEvent']>;
		try {
			event = gateway.constructEvent(rawBody, signature, secret);
		} catch {
			return c.json(
				{ ok: false, error: 'invalid_signature', message: 'The Stripe signature did not verify.' },
				400,
			);
		}

		// Hard tenancy rule: a Connect event may only act after its signed account resolves to
		// exactly one active connection. No account, or an unknown one, means we cannot say which
		// tenant it belongs to, so we record it and do nothing rather than guess.
		const account = eventAccount(event);
		const connection = account ? await getConnectionByStripeAccount(deps.db, account) : undefined;
		if (connection?.status !== 'active') {
			await writeAudit(deps.db, {
				action: 'stripe.connect_unroutable',
				actor: `stripe:${event.id}`,
				detail: { event: event.id, type: event.type, stripe_account: account },
			});
			return c.json({ ok: true, received: true }, 200);
		}

		// A vendor revoking access is a connection-lifecycle event, not issuance: retire its
		// grants and stop here. Idempotent, so a redelivery is a clean no-op.
		if (event.type === 'account.application.deauthorized') {
			await disconnectConnection(deps, {
				stripeAccountId: connection.stripeAccountId,
				actor: `stripe:${event.id}`,
			});
			return c.json({ ok: true, received: true }, 200);
		}

		// Everything else runs the shared idempotent path, scoped to this connection: grant
		// lookup uses its id, and the row is attributed to its account. The connected account's
		// own data (line items, subscription period) lives in that Stripe account, so read it
		// through a gateway bound to it (Stripe-Account header) swapped in as `stripe`.
		const scoped = { ...deps, stripe: gateway.forAccount(connection.stripeAccountId) };
		await handleStripeEvent(scoped, event, {
			connectionId: connection.id,
			accountId: connection.accountId,
		});
		return c.json({ ok: true, received: true }, 200);
	});
}
