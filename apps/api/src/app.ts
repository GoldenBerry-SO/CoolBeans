// ABOUTME: Composition root for the Cool Beans API — builds the OpenAPIHono app from injected deps.
// ABOUTME: Dependencies are injected so handlers stay testable via app.request with no HTTP server.

import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { logger as requestLogger } from 'hono/logger';
import type { AppDeps } from './deps.js';
import { toErrorResponse } from './http/errors.js';
import { publicPaths } from './http/openapi.js';
import { redactLogLine } from './http/redact.js';
import { registerAdminRoutes } from './routes/admin/index.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPublicRoutes } from './routes/v1/index.js';
import { registerWebhookRoutes } from './routes/webhooks/index.js';

export function createApp(deps: AppDeps) {
	const app = new OpenAPIHono();

	// The key is the credential (§19): redact it before any request line hits the logs.
	app.use(requestLogger((message) => deps.logger.info(redactLogLine(message))));

	// The public client API is called from browsers and desktop webviews (§11).
	app.use('/v1/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));

	app.onError((err, c) => {
		if (!(err instanceof Error) || err.name !== 'ApiError') {
			deps.logger.error('Unhandled error', { message: String(err) });
		}
		return toErrorResponse(c, err);
	});

	app.get('/health', (c) => c.json({ ok: true, status: 'ok' }));

	// Rate limit the public surface, but never webhooks (signature-verified, providers burst).
	if (deps.rateLimit) {
		const limiter = deps.rateLimit;
		app.use('/v1/*', async (c, next) => {
			if (c.req.path.includes('/webhook')) return next();
			return limiter(c, next);
		});
	}

	// Webhooks first: they need the raw body and their own (signature) auth.
	registerWebhookRoutes(app, deps);
	registerPublicRoutes(app, deps);
	registerAuthRoutes(app, deps);
	registerAdminRoutes(app, deps);

	// Served directly rather than through app.doc(): that helper only collects routes
	// declared via app.openapi(), and ours are plain handlers, so it would publish an
	// empty document. The frozen §9 surface is described explicitly and pinned by a test.
	app.get('/doc', (c) =>
		c.json({
			openapi: '3.1.0',
			info: {
				title: 'Cool Beans API',
				version: '0.0.0',
				description:
					'The open-source license layer. Issue a key, activate it, check it is still good. This document covers the frozen public contract (PRD §9) that products build against; the admin surface is described in docs/PRD.md §16.',
			},
			paths: publicPaths,
		}),
	);
	app.get('/docs', Scalar({ url: '/doc' }));

	return app;
}

export type App = ReturnType<typeof createApp>;
