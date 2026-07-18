// ABOUTME: API rate limiting (PRD §18, §19) — Redis-backed so limits hold across k8s replicas.
// ABOUTME: Keyed per license key when present, else per IP; webhooks are never limited.

import type { Logger } from '@coolbeans/logger';
import type { MiddlewareHandler } from 'hono';
import { rateLimiter, type Store } from 'hono-rate-limiter';
import type { Config } from '../config.js';

/** Prefer x-real-ip, fall back to x-forwarded-for, then a constant (single-instance dev). */
function clientKey(headers: Headers): string {
	return (
		headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
	);
}

async function bodyLicenseKey(c: { req: { raw: Request } }): Promise<string | null> {
	try {
		const clone = c.req.raw.clone();
		const data = (await clone.json()) as { license_key?: string };
		return data.license_key ?? null;
	} catch {
		return null;
	}
}

export interface RateLimitOptions {
	config: Config;
	logger: Logger;
	/** Optional shared store (RedisStore). Defaults to in-memory (fine for single-instance/dev). */
	store?: Store;
	/** Requests per minute per key. PRD §18 suggests 30/min on /v1/*. */
	perMinute?: number;
}

/** A rate limiter for the public /v1 surface, keyed per license key or IP. */
export function publicRateLimiter(opts: RateLimitOptions): MiddlewareHandler {
	return rateLimiter({
		windowMs: 60_000,
		limit: opts.perMinute ?? 30,
		standardHeaders: 'draft-6',
		store: opts.store,
		keyGenerator: async (c) => {
			const licenseKey = await bodyLicenseKey(c);
			return licenseKey ?? clientKey(c.req.raw.headers);
		},
	});
}
