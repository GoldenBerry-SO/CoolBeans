// ABOUTME: Stripe webhook route (PRD §13) — verify the raw body's signature before parsing anything.
// ABOUTME: Global secret at /v1/stripe/webhook; per-product secret at /v1/stripe/webhook/:product.

import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppDeps } from '../../deps.js';
import { handleStripeEvent } from '../../services/stripe.js';
import { getProductBySlug } from '../../store/products.js';

async function process(
	deps: AppDeps,
	rawBody: string,
	signature: string | undefined,
	secret: string | undefined,
): Promise<{ status: number; body: unknown }> {
	if (!deps.stripe) return { status: 503, body: { ok: false, error: 'stripe_not_configured' } };
	if (!secret) return { status: 503, body: { ok: false, error: 'stripe_not_configured' } };
	if (!signature) return { status: 400, body: { ok: false, error: 'missing_signature' } };
	let event: ReturnType<NonNullable<AppDeps['stripe']>['constructEvent']>;
	try {
		event = deps.stripe.constructEvent(rawBody, signature, secret);
	} catch {
		return { status: 400, body: { ok: false, error: 'invalid_signature' } };
	}
	// A thrown error here (e.g. email send failure) becomes a 500 so Stripe retries.
	await handleStripeEvent(deps, event);
	return { status: 200, body: { ok: true, received: true } };
}

export function registerStripeWebhook(app: OpenAPIHono, deps: AppDeps): void {
	app.post('/v1/stripe/webhook', async (c) => {
		const rawBody = await c.req.text();
		const result = await process(
			deps,
			rawBody,
			c.req.header('stripe-signature'),
			deps.config.stripe?.webhookSecret,
		);
		return c.json(result.body as object, result.status as never);
	});

	app.post('/v1/stripe/webhook/:product', async (c) => {
		const product = getProductBySlug(deps.db, c.req.param('product'));
		const rawBody = await c.req.text();
		const result = await process(
			deps,
			rawBody,
			c.req.header('stripe-signature'),
			product?.stripeWebhookSecret ?? deps.config.stripe?.webhookSecret,
		);
		return c.json(result.body as object, result.status as never);
	});
}
