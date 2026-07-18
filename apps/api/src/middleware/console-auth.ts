// ABOUTME: Combined console auth — magic-code session (cbs_…), env admin token, or product token.
// ABOUTME: Guards /admin/*; a cbp_ token is scoped to one product and default-denied elsewhere.

import type { MiddlewareHandler } from 'hono';
import type { AppDeps } from '../deps.js';
import { forbidden, unauthorized } from '../http/errors.js';
import { adminForSession } from '../services/console-auth.js';
import { productForToken } from '../services/product-tokens.js';
import { isAdminRequest } from './admin-auth.js';

/**
 * Paths a per-product token may reach, as regexes against the path after /admin.
 * Default-deny: anything not listed here is global (team, stats, audit, product
 * creation, token rotation) and belongs to a full admin. Ownership of the named
 * product is checked separately in the handlers.
 */
const PRODUCT_SCOPED: { method: string; path: RegExp }[] = [
	{ method: 'GET', path: /^\/products$/ },
	{ method: 'GET', path: /^\/products\/[^/]+$/ },
	{ method: 'PATCH', path: /^\/products\/[^/]+$/ },
	{ method: 'GET', path: /^\/products\/[^/]+\/keys$/ },
	{ method: 'POST', path: /^\/products\/[^/]+\/metrics$/ },
	{ method: 'POST', path: /^\/products\/[^/]+\/signing-keys\/rotate$/ },
	{ method: 'POST', path: /^\/products\/[^/]+\/stripe\/connect$/ },
	{ method: 'POST', path: /^\/keys$/ },
	{ method: 'GET', path: /^\/keys\/[^/]+$/ },
	{ method: 'POST', path: /^\/keys\/[^/]+\/(disable|enable)$/ },
	{ method: 'GET', path: /^\/purchases$/ },
];

function scopeAllows(method: string, path: string): boolean {
	return PRODUCT_SCOPED.some((r) => r.method === method && r.path.test(path));
}

export function consoleAuth(deps: AppDeps): MiddlewareHandler {
	return async (c, next) => {
		const header = c.req.header('Authorization') ?? '';
		if (isAdminRequest(header, deps.config.adminToken)) {
			await next();
			return;
		}
		const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
		if (!presented) throw unauthorized();

		const admin = adminForSession(deps, presented);
		if (admin) {
			c.set('adminEmail', admin.email);
			await next();
			return;
		}

		const product = productForToken(deps, presented);
		if (!product) throw unauthorized();
		const path = new URL(c.req.url).pathname.replace(/^\/admin/, '');
		if (!scopeAllows(c.req.method, path)) {
			throw forbidden('This token is scoped to one product and cannot reach that endpoint.');
		}
		c.set('productScope', product);
		await next();
	};
}
