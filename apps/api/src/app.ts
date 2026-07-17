// ABOUTME: Composition root for the Cool Beans API — builds the OpenAPIHono app with all routes.
// ABOUTME: Dependencies are injected so handlers stay testable via app.request with no HTTP server.

import { createLogger, type Logger } from '@coolbeans/logger';
import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { logger as requestLogger } from 'hono/logger';

export interface AppDeps {
	// Dependencies (database, email sender, payment providers) are injected here so the
	// Node and Workers entrypoints can construct them from their own environments.
	logger?: Logger;
	version?: string;
}

export function createApp(deps: AppDeps = {}) {
	const log = deps.logger ?? createLogger();
	const app = new OpenAPIHono();

	app.use(requestLogger((message) => log.info(message)));

	app.get('/health', (c) => c.json({ ok: true, status: 'ok' }));

	app.doc('/doc', {
		openapi: '3.1.0',
		info: {
			title: 'Cool Beans API',
			version: '0.0.0',
			description:
				'The open-source license layer. Issue a key, activate it, check it is still good.',
		},
	});
	app.get('/docs', Scalar({ url: '/doc' }));

	return app;
}
