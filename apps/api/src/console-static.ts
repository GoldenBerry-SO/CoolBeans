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
	// Serve any real file from the build first: hashed /assets/*, plus the root brand assets
	// (favicon set, apple-touch, PWA icons, logo.png). serveStatic calls next() when the file
	// does not exist, so anything that is not a real file drops through to the SPA fallback.
	// This is what makes /logo.png resolve to the image instead of index.html — the emails
	// point at it, so it has to be a real 200 image, not the console HTML.
	//
	// GET/HEAD only. A static file is a read; without this gate the catch-all would answer
	// POST /logo.png with a 200 image and OPTIONS / with index.html, turning asset paths into
	// accidental non-read endpoints instead of the normal 404. Other methods fall through.
	const serveFiles = serveStatic({ root: webRoot });
	app.use('*', (c, next) => {
		if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
		return serveFiles(c, next);
	});
	// SPA fallback for any non-API GET: serve index.html so client routing works on refresh.
	// API prefixes are excluded even though real routes are registered first, because an
	// UNKNOWN path under them would otherwise fall through to this catch-all — and a
	// client that typos an endpoint would get a 200 full of HTML instead of the JSON 404
	// the surface promises. Found live on /v1/nonexistent.
	const spaFallback = serveStatic({ root: webRoot, path: 'index.html' });
	// Bare roots AND everything under them: startsWith('/v1/') alone misses a plain GET
	// /v1, the single most plausible mistyped API URL there is. /docs is its own root
	// because '/doc' with the slash rule would no longer cover it.
	const apiRoots = ['/v1', '/admin', '/auth', '/doc', '/docs'];
	app.get('*', (c, next) => {
		const path = c.req.path;
		if (apiRoots.some((root) => path === root || path.startsWith(`${root}/`))) return next();
		return spaFallback(c, next);
	});
	deps.logger.info('Console served from build', { webRoot });
}
