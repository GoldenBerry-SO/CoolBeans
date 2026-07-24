// ABOUTME: Per-key throttle behaviour (issue #39) — lockout, recovery, and what counts as a probe.
// ABOUTME: The bypass-resistance case lives in p1-fixes.test.ts; this pins the state machine.

import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../http/errors.js';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { createProduct, issueKey } from '../test/seed.js';
import { assertKeyNotThrottled, clearKeyFailures, recordKeyFailure } from './key-throttle.js';

let h: TestHarness;
const UNKNOWN = 'CLEM-ZZZZ-ZZZZ-ZZZZ-ZZZZ';

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
});

const failTimes = (key: string, n: number) => {
	for (let i = 0; i < n; i += 1) recordKeyFailure(h.deps, key);
};

describe('per-key throttle', () => {
	it('allows a reasonable number of failures before locking', async () => {
		failTimes(UNKNOWN, 9);
		expect(() => assertKeyNotThrottled(h.deps, UNKNOWN)).not.toThrow();
	});

	it('locks the key out once the failures pile up', async () => {
		failTimes(UNKNOWN, 10);
		expect(() => assertKeyNotThrottled(h.deps, UNKNOWN)).toThrow(ApiError);
	});

	it('throttles the key, not the caller, so rotating IPs does not help', async () => {
		// The whole point: state is keyed by the licence key. A different key is unaffected.
		failTimes(UNKNOWN, 12);
		expect(() => assertKeyNotThrottled(h.deps, UNKNOWN)).toThrow();
		expect(() => assertKeyNotThrottled(h.deps, 'CLEM-AAAA-BBBB-CCCC-DDDD')).not.toThrow();
	});

	it('normalizes, so dashes and case cannot dodge the count', async () => {
		failTimes(UNKNOWN, 10);
		expect(() =>
			assertKeyNotThrottled(h.deps, UNKNOWN.replaceAll('-', '').toLowerCase()),
		).toThrow();
	});

	it('lets the key back in once the lockout lapses', async () => {
		failTimes(UNKNOWN, 10);
		expect(() => assertKeyNotThrottled(h.deps, UNKNOWN)).toThrow();
		// A lockout that never lifts turns a burst of typos into a permanent denial.
		h.clock.advance(6 * 60_000);
		expect(() => assertKeyNotThrottled(h.deps, UNKNOWN)).not.toThrow();
	});

	it('forgets failures that fall outside the window', async () => {
		failTimes(UNKNOWN, 9);
		h.clock.advance(61_000);
		failTimes(UNKNOWN, 9);
		expect(() => assertKeyNotThrottled(h.deps, UNKNOWN)).not.toThrow();
	});

	it('clears the count when the key turns out to be real', async () => {
		failTimes(UNKNOWN, 9);
		clearKeyFailures(UNKNOWN);
		failTimes(UNKNOWN, 9);
		expect(() => assertKeyNotThrottled(h.deps, UNKNOWN)).not.toThrow();
	});

	it('does not count a disabled key against the throttle', async () => {
		// A disabled key is a definitive answer, not a probe. Counting it would let a
		// refunded customer's own retries lock them out of ever seeing the real status.
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'buyer@example.com',
			kind: 'perpetual',
		});
		await h.app.request(`/admin/keys/${encodeURIComponent(key)}/disable`, {
			method: 'POST',
			headers: h.adminHeaders,
		});
		for (let i = 0; i < 12; i += 1) {
			const res = await h.app.request('/v1/validate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ license_key: key, instance_id: 'x' }),
			});
			expect(res.status).toBe(200);
		}
	});
});
