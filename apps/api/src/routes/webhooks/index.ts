// ABOUTME: Webhook route mount (PRD §13) — provider webhooks are registered here, raw-body + signature.
// ABOUTME: Stripe and PayPal handlers verify signatures before parsing; nothing here trusts a raw body.

import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppDeps } from '../../deps.js';
import { registerBillingWebhook } from './billing.js';
import { registerConnectWebhook } from './connect.js';
import { registerPayPalWebhook } from './paypal.js';
import { registerStripeWebhook } from './stripe.js';

export function registerWebhookRoutes(app: OpenAPIHono, deps: AppDeps): void {
	registerStripeWebhook(app, deps);
	// Cloud multi-vendor: one platform endpoint for every connected account, routed by the
	// signed event.account. Self-host never configures Connect, so this stays inert there.
	registerConnectWebhook(app, deps);
	registerPayPalWebhook(app, deps);
	// Our own subscription business, on its own URL and its own signing secret. Not a
	// variant of the Stripe webhook above: that one is a customer selling their software.
	registerBillingWebhook(app, deps);
}
