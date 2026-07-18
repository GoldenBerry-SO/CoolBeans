// ABOUTME: Combined console auth — a magic-code session (cbs_…) OR the global admin token.
// ABOUTME: Guards /admin/*; the CLI keeps using the env token, humans use sessions.

import type { MiddlewareHandler } from 'hono';
import type { AppDeps } from '../deps.js';
import { unauthorized } from '../http/errors.js';
import { adminForSession } from '../services/console-auth.js';
import { isAdminRequest } from './admin-auth.js';

export function consoleAuth(deps: AppDeps): MiddlewareHandler {
	return async (c, next) => {
		const header = c.req.header('Authorization') ?? '';
		if (isAdminRequest(header, deps.config.adminToken)) {
			await next();
			return;
		}
		const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
		const admin = presented ? adminForSession(deps, presented) : undefined;
		if (!admin) throw unauthorized();
		c.set('adminEmail', admin.email);
		await next();
	};
}
