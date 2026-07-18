// ABOUTME: Webhook route mount (PRD §13) — provider webhooks are registered here, raw-body + signature.
// ABOUTME: Stripe and PayPal handlers attach in their own modules; nothing here parses before verifying.

import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppDeps } from '../../deps.js';

export function registerWebhookRoutes(_app: OpenAPIHono, _deps: AppDeps): void {
	// Stripe and PayPal handlers register here once payments are wired.
}
