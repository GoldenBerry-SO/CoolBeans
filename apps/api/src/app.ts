// ABOUTME: Composition root for the Cool Beans API — builds the OpenAPIHono app with all routes.
// ABOUTME: Runtime-agnostic: src/node.ts serves it on Node, src/worker.ts exports it for Workers.

import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';

export interface AppDeps {
	// Dependencies (database, email sender, payment providers) are injected here so the
	// Node and Workers entrypoints can construct them from their own environments.
	version?: string;
}

export function createApp(_deps: AppDeps = {}) {
	const app = new OpenAPIHono();

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
