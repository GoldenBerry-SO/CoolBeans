// ABOUTME: Stripe webhook route (PRD §13) — verify the raw body's signature before parsing anything.
// ABOUTME: One endpoint per connection at /v1/stripe/webhook; a per-product alias attributes cloud rows.

import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppDeps } from '../../deps.js';
import { handleStripeEvent } from '../../services/stripe.js';
import { getConnection } from '../../store/grants.js';
import { getProductBySlugGlobal } from '../../store/products.js';

/** The connection an event runs under: its id scopes grant lookup, its account attributes rows. */
interface WebhookContext {
	connectionId?: number;
	accountId?: number;
}

async function process(
	deps: AppDeps,
	rawBody: string,
	signature: string | undefined,
	secret: string | undefined,
	ctx: WebhookContext,
): Promise<{ status: number; body: unknown }> {
	if (!deps.stripe)
		return {
			status: 503,
			body: {
				ok: false,
				error: 'stripe_not_configured',
				message: 'Stripe is not configured on this server.',
			},
		};
	if (!secret)
		return {
			status: 503,
			body: {
				ok: false,
				error: 'stripe_not_configured',
				message: 'Stripe is not configured on this server.',
			},
		};
	if (!signature)
		return {
			status: 400,
			body: {
				ok: false,
				error: 'missing_signature',
				message: 'A Stripe signature header is required.',
			},
		};
	let event: ReturnType<NonNullable<AppDeps['stripe']>['constructEvent']>;
	try {
		event = deps.stripe.constructEvent(rawBody, signature, secret);
	} catch {
		return {
			status: 400,
			body: {
				ok: false,
				error: 'invalid_signature',
				message: 'The Stripe signature did not verify.',
			},
		};
	}
	// A thrown error here (e.g. email send failure) becomes a 500 so Stripe retries.
	await handleStripeEvent(deps, event, ctx);
	return { status: 200, body: { ok: true, received: true } };
}

export function registerStripeWebhook(app: OpenAPIHono, deps: AppDeps): void {
	// The connection carries the signing secret and the account a delivery belongs to. Every
	// product on a self-host instance shares this one connection, so connect points Stripe at
	// a single endpoint (not one per product) and there is a single secret to verify against.
	const resolve = async () => {
		const connection = await getConnection(deps.db);
		return { connection, secret: connection?.webhookSecret ?? deps.config.stripe?.webhookSecret };
	};

	app.post('/v1/stripe/webhook', async (c) => {
		const { connection, secret } = await resolve();
		const rawBody = await c.req.text();
		const result = await process(deps, rawBody, c.req.header('stripe-signature'), secret, {
			connectionId: connection?.id,
			accountId: connection?.accountId,
		});
		return c.json(result.body as object, result.status as never);
	});

	// Per-product alias: the URL earlier connect flows registered. It runs on the same
	// connection but attributes the delivery to the named product's account, so a cloud
	// console shows the row under the right tenant until Connect routes by event.account.
	app.post('/v1/stripe/webhook/:product', async (c) => {
		const product = await getProductBySlugGlobal(deps.db, c.req.param('product'));
		const { connection, secret } = await resolve();
		const rawBody = await c.req.text();
		const result = await process(deps, rawBody, c.req.header('stripe-signature'), secret, {
			connectionId: connection?.id,
			accountId: product?.accountId ?? connection?.accountId,
		});
		return c.json(result.body as object, result.status as never);
	});
}
