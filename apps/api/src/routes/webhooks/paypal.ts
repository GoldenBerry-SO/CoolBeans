// ABOUTME: PayPal webhook route (PRD §13) — verify the transmission signature before parsing.
// ABOUTME: Shares the issuance core with Stripe; only the verification and event shapes differ.

import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppDeps } from '../../deps.js';
import { handlePayPalEvent } from '../../services/paypal.js';
import type { PayPalEvent } from '../../services/paypal-gateway.js';

export function registerPayPalWebhook(app: OpenAPIHono, deps: AppDeps): void {
	app.post('/v1/paypal/webhook', async (c) => {
		if (!deps.paypal || !deps.config.paypal) {
			return c.json({ ok: false, error: 'paypal_not_configured' }, 503);
		}
		const rawBody = await c.req.text();
		const verified = await deps.paypal.verify({
			transmissionId: c.req.header('paypal-transmission-id') ?? '',
			transmissionTime: c.req.header('paypal-transmission-time') ?? '',
			transmissionSig: c.req.header('paypal-transmission-sig') ?? '',
			certUrl: c.req.header('paypal-cert-url') ?? '',
			authAlgo: c.req.header('paypal-auth-algo') ?? '',
			webhookId: deps.config.paypal.webhookId,
			body: rawBody,
		});
		if (!verified) return c.json({ ok: false, error: 'invalid_signature' }, 400);
		const event = JSON.parse(rawBody) as PayPalEvent;
		await handlePayPalEvent(deps, event);
		return c.json({ ok: true, received: true });
	});
}
