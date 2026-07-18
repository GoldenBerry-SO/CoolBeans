// ABOUTME: API rate limiting (PRD §18, §19) — per-IP fixed window, Redis-backed across replicas.
// ABOUTME: Keyed by the connection IP (never by attacker-supplied body fields); 429 uses the §9 envelope.

import type { Logger } from '@coolbeans/logger';
import type { MiddlewareHandler } from 'hono';
import { rateLimiter, type Store } from 'hono-rate-limiter';
import type { Config } from '../config.js';

/**
 * The client bucket key. x-real-ip is set by our ingress (k8s) or compose proxy; the
 * x-forwarded-for fallback takes the FIRST hop, which is only trustworthy behind a
 * proxy that overwrites the header. Direct deployments fall back to a single bucket.
 */
function clientKey(headers: Headers): string {
	return (
		headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
	);
}

export interface RateLimitOptions {
	config: Config;
	logger: Logger;
	/** Optional shared store (RedisStore). Defaults to in-memory (fine for single-instance/dev). */
	store?: Store;
	/** Requests per minute per IP. PRD §18 suggests 30/min on /v1/*. */
	perMinute?: number;
}

function ipRateLimiter(
	opts: RateLimitOptions,
	bucket: string,
	defaultLimit: number,
): MiddlewareHandler {
	return rateLimiter({
		windowMs: 60_000,
		limit: opts.perMinute ?? defaultLimit,
		standardHeaders: 'draft-6',
		store: opts.store,
		// Separate auth and public buckets. A busy licensed client must not prevent its
		// operator from signing in, while both surfaces remain limited across replicas.
		keyGenerator: (c) => `${bucket}:${clientKey(c.req.raw.headers)}`,
		handler: (c) =>
			c.json(
				{
					ok: false,
					error: 'rate_limited',
					message: 'Too many requests. Slow down and try again shortly.',
				},
				429,
			),
	});
}

/** A rate limiter for the public /v1 surface, keyed per client IP. */
export function publicRateLimiter(opts: RateLimitOptions): MiddlewareHandler {
	return ipRateLimiter(opts, 'public', 30);
}

/** A tighter bucket for requesting and verifying console magic codes. */
export function authRateLimiter(opts: RateLimitOptions): MiddlewareHandler {
	return ipRateLimiter(opts, 'auth', 10);
}
