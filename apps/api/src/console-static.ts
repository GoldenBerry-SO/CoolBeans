// ABOUTME: Serve the built console SPA from the API in production (PRD §16, §27).
// ABOUTME: Static assets + an index.html fallback for client-side routes; API routes win (registered first).

import { existsSync } from 'node:fs';
import { serveStatic } from '@hono/node-server/serve-static';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppDeps } from './deps.js';

/**
 * Mount static serving for the console build if it exists. Called after all API routes so
 * /v1, /admin, webhooks, /doc, /health take precedence; everything else falls back to the SPA.
 */
export function mountConsole(app: OpenAPIHono, deps: AppDeps, webRoot: string): void {
	if (!existsSync(webRoot)) {
		deps.logger.info('Console not served: build not found', { webRoot });
		return;
	}
	app.use('/assets/*', serveStatic({ root: webRoot }));
	app.get('/favicon.ico', serveStatic({ root: webRoot, path: 'favicon.ico' }));
	// SPA fallback for any non-API GET: serve index.html so client routing works on refresh.
	app.get('*', serveStatic({ root: webRoot, path: 'index.html' }));
	deps.logger.info('Console served from build', { webRoot });
}
