// ABOUTME: Admin bearer-token auth (PRD §16, §19) — constant-time compare, token never logged.
// ABOUTME: A factory over the configured admin token; the public license API never uses this.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { unauthorized } from '../http/errors.js';

/**
 * Constant-time compare via fixed-size digests: hashing both sides first removes the
 * length-mismatch branch entirely, so timing is independent of the presented value.
 */
export function safeEqual(a: string, b: string): boolean {
	const digestA = createHash('sha256').update(a).digest();
	const digestB = createHash('sha256').update(b).digest();
	return timingSafeEqual(digestA, digestB);
}

/** True when the Authorization header carries the admin bearer token. */
export function isAdminRequest(header: string | undefined, adminToken: string): boolean {
	const prefix = 'Bearer ';
	if (!header?.startsWith(prefix)) return false;
	return safeEqual(header.slice(prefix.length), adminToken);
}

/** Require `Authorization: Bearer <adminToken>`. Throws 401 on any mismatch. */
export function adminAuth(adminToken: string): MiddlewareHandler {
	return async (c, next) => {
		if (!isAdminRequest(c.req.header('Authorization'), adminToken)) throw unauthorized();
		await next();
	};
}
