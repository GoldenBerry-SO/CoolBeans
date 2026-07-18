// ABOUTME: Admin bearer-token auth (PRD §16, §19) — constant-time compare, token never logged.
// ABOUTME: A factory over the configured admin token; the public license API never uses this.

import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { unauthorized } from '../http/errors.js';

/** Constant-time string compare that does not short-circuit on length. */
function safeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) {
		// Compare against self to keep timing independent of the mismatch length.
		timingSafeEqual(bufA, bufA);
		return false;
	}
	return timingSafeEqual(bufA, bufB);
}

/** Require `Authorization: Bearer <adminToken>`. Throws 401 on any mismatch. */
export function adminAuth(adminToken: string): MiddlewareHandler {
	return async (c, next) => {
		const header = c.req.header('Authorization') ?? '';
		const prefix = 'Bearer ';
		if (!header.startsWith(prefix)) throw unauthorized();
		const presented = header.slice(prefix.length);
		if (!safeEqual(presented, adminToken)) throw unauthorized();
		await next();
	};
}
