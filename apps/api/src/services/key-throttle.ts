// ABOUTME: Per-key brute-force throttle (issue #39) — failures against one key back off.
// ABOUTME: Complements the per-IP window, which an attacker defeats by rotating addresses.

import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { ApiError } from '../http/errors.js';

const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;
const LOCKOUT_MS = 5 * 60_000;

interface Attempt {
	failures: number;
	windowStart: number;
	lockedUntil: number;
}

/**
 * In-process state. A single replica is the common self-host shape, and the
 * consequence of not sharing this across replicas is a proportionally higher
 * ceiling, not a bypass. Sharing it belongs with the Redis work in #32.
 */
const attempts = new Map<string, Attempt>();

/** Normalize to the same bucket a key would resolve to, so case/dashes cannot split it. */
function bucket(keyInput: string): string {
	return keyInput.replace(/[\s-]/g, '').toUpperCase().slice(0, 64);
}

export function assertKeyNotThrottled(deps: AppDeps, keyInput: string): void {
	const now = nowDate(deps).getTime();
	const entry = attempts.get(bucket(keyInput));
	if (entry && entry.lockedUntil > now) {
		throw new ApiError(
			429,
			'rate_limited',
			'Too many failed attempts for this license key. Try again in a few minutes.',
		);
	}
}

export function recordKeyFailure(deps: AppDeps, keyInput: string): void {
	const now = nowDate(deps).getTime();
	const id = bucket(keyInput);
	const entry = attempts.get(id);
	if (!entry || now - entry.windowStart > WINDOW_MS) {
		attempts.set(id, { failures: 1, windowStart: now, lockedUntil: 0 });
		return;
	}
	entry.failures += 1;
	if (entry.failures >= MAX_FAILURES) {
		entry.lockedUntil = now + LOCKOUT_MS;
		entry.failures = 0;
		entry.windowStart = now;
	}
}

/** A real client got through, so the key is not under attack. */
export function clearKeyFailures(keyInput: string): void {
	attempts.delete(bucket(keyInput));
}

/** Test seam: forget all throttle state. */
export function resetKeyThrottle(): void {
	attempts.clear();
}
