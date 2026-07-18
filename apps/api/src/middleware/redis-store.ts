// ABOUTME: A Redis-backed rate-limit store (PRD §18) — fixed window via INCR + PEXPIRE.
// ABOUTME: Shared across k8s replicas so a per-key limit holds regardless of which pod serves.

import type { Store } from 'hono-rate-limiter';
import type Redis from 'ioredis';

interface ClientRateLimitInfo {
	totalHits: number;
	resetTime?: Date;
}

/** Fixed-window store keyed by `cb:rl:<key>`; correct enough for API throttling. */
export function createRedisStore(redis: Redis, windowMs: number): Store {
	const prefix = 'cb:rl:';
	return {
		async increment(key: string): Promise<ClientRateLimitInfo> {
			const k = prefix + key;
			const hits = await redis.incr(k);
			if (hits === 1) await redis.pexpire(k, windowMs);
			const ttl = await redis.pttl(k);
			return {
				totalHits: hits,
				resetTime: ttl > 0 ? new Date(Date.now() + ttl) : undefined,
			};
		},
		async decrement(key: string): Promise<void> {
			await redis.decr(prefix + key);
		},
		async resetKey(key: string): Promise<void> {
			await redis.del(prefix + key);
		},
	};
}
