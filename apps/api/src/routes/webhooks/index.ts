// ABOUTME: Webhook route mount (PRD §13) — provider webhooks are registered here, raw-body + signature.
// ABOUTME: Stripe and PayPal handlers verify signatures before parsing; nothing here trusts a raw body.

import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppDeps } from '../../deps.js';
import { registerPayPalWebhook } from './paypal.js';
import { registerStripeWebhook } from './stripe.js';

export function registerWebhookRoutes(app: OpenAPIHono, deps: AppDeps): void {
	registerStripeWebhook(app, deps);
	registerPayPalWebhook(app, deps);
}
