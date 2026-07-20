// ABOUTME: Platform billing webhook — customers paying us, verified against its own signing secret.
// ABOUTME: Physically cannot be confused with /v1/stripe/webhook: different URL, secret, gateway and key.

import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppDeps } from '../../deps.js';
import { BILLING_PROVIDER, handleBillingEvent } from '../../services/billing.js';
import {
	attributeEvent,
	claimEventStatus,
	completeEvent,
	releaseEvent,
} from '../../services/payments.js';

export function registerBillingWebhook(app: OpenAPIHono, deps: AppDeps): void {
	app.post('/v1/billing/stripe/webhook', async (c) => {
		const secret = deps.config.billing?.stripeWebhookSecret;
		if (!deps.billing || !secret) {
			return c.json(
				{
					ok: false,
					error: 'billing_not_configured',
					message: 'Platform billing is not configured on this server.',
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
		// Raw body, then verify, then parse — never the other way round.
		const rawBody = await c.req.text();
		let event: ReturnType<NonNullable<AppDeps['billing']>['constructEvent']>;
		try {
			event = deps.billing.constructEvent(rawBody, signature, secret);
		} catch {
			// A product-sales payload cannot reach this branch successfully: it is signed
			// with a different secret, so verification fails before anything is parsed.
			return c.json(
				{
					ok: false,
					error: 'invalid_signature',
					message: 'The Stripe signature did not verify.',
				},
				400,
			);
		}

		// Same two-layer idempotency the product webhook uses. provider_events.id is the
		// primary key and Stripe event ids are globally unique, so both integrations share
		// the table without colliding while the provider column keeps them apart.
		const claim = await claimEventStatus(deps, {
			id: event.id,
			provider: BILLING_PROVIDER,
			type: event.type,
		});
		if (claim.result === 'done') return c.json({ ok: true, received: true, duplicate: true });
		if (claim.result === 'in_flight') {
			// Another worker holds it. 409 so Stripe retries rather than considering it done.
			return c.json({ ok: false, error: 'in_flight', message: 'Already being processed.' }, 409);
		}

		try {
			const result = await handleBillingEvent(deps, event);
			// The account is only knowable after parsing, so attribute the delivery now
			// rather than at claim time. Without this the console's Webhooks page shows a
			// cloud account nothing at all.
			if (result.accountId !== undefined) {
				await attributeEvent(deps, event.id, result.accountId);
			}
		} catch (err) {
			// Hand the claim back so Stripe's retry re-enters rather than being deduped away
			// with the work half done.
			await releaseEvent(deps, event.id, claim.token);
			deps.logger.error('Platform billing webhook failed', {
				event: event.id,
				type: event.type,
				message: (err as Error).message,
			});
			throw err;
		}
		await completeEvent(deps, event.id, claim.token);
		return c.json({ ok: true, received: true });
	});
}
