// ABOUTME: The optional check scheduler (issue #56) — launch check, jittered refresh, heartbeat.
// ABOUTME: A failed refresh must never throw into the app or disturb the cached token.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoolBeans } from './index.js';

function memStorage() {
	const m = new Map<string, string>();
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
	};
}

/** Records every call so a test can count refreshes and heartbeats separately. */
function countingFetch(behaviour: { failVerify?: boolean } = {}) {
	const calls: string[] = [];
	const fetchImpl = (async (url: string | URL | Request): Promise<Response> => {
		const path = new URL(String(url)).pathname;
		calls.push(path);
		if (path === '/v1/validate') {
			if (behaviour.failVerify) throw new Error('network down');
			return new Response(
				JSON.stringify({
					ok: true,
					license: {
						key: 'CLEM-A2B3-C4D5-E6F7-G8H9',
						status: 'active',
						tier: 'yearly',
						product: 'clementine',
						expires_at: null,
					},
					instance: { id: 'i', name: 'n' },
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		}
		if (path === '/v1/heartbeat') {
			return new Response(JSON.stringify({ ok: true, lease_expires_at: '2027-01-01T00:00:00Z' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		return new Response(JSON.stringify({ ok: true, keys: {} }), { status: 200 });
	}) as typeof fetch;
	return { calls, fetchImpl, count: (p: string) => calls.filter((c) => c === p).length };
}

function client(fetchImpl: typeof fetch) {
	return new CoolBeans({ product: 'clementine', storage: memStorage(), fetch: fetchImpl });
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('start()', () => {
	it('verifies immediately rather than waiting for the first interval', async () => {
		// Blocking startup on the network is an anti-pattern, but so is leaving the app
		// with a stale answer for a whole interval. Fire at once, asynchronously.
		const { fetchImpl, count } = countingFetch();
		const watcher = client(fetchImpl).start({
			licenseKey: 'CLEM-A2B3-C4D5-E6F7-G8H9',
			instanceId: 'i',
			intervalMs: 60_000,
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(count('/v1/validate')).toBe(1);
		watcher.stop();
	});

	it('refreshes again after the interval', async () => {
		const { fetchImpl, count } = countingFetch();
		const watcher = client(fetchImpl).start({
			licenseKey: 'CLEM-A2B3-C4D5-E6F7-G8H9',
			instanceId: 'i',
			intervalMs: 60_000,
			jitter: 0,
		});
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(count('/v1/validate')).toBe(2);
		watcher.stop();
	});

	it('spreads the interval with jitter so installs do not synchronise', async () => {
		// Every copy of an app checking at the same moment is a thundering herd against
		// one server. The delay must vary run to run, within a bounded window.
		const low = countingFetch();
		const high = countingFetch();
		const watcherLow = client(low.fetchImpl).start({
			licenseKey: 'K',
			instanceId: 'i',
			intervalMs: 60_000,
			jitter: 0.5,
			random: () => 0,
		});
		const watcherHigh = client(high.fetchImpl).start({
			licenseKey: 'K',
			instanceId: 'i',
			intervalMs: 60_000,
			jitter: 0.5,
			random: () => 1,
		});
		await vi.advanceTimersByTimeAsync(0);

		// At the low end of the jitter window the second check has already fired.
		await vi.advanceTimersByTimeAsync(30_000);
		expect(low.count('/v1/validate')).toBe(2);
		// At the high end it has not, so the two are genuinely spread apart.
		expect(high.count('/v1/validate')).toBe(1);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(high.count('/v1/validate')).toBe(2);
		watcherLow.stop();
		watcherHigh.stop();
	});

	it('never heartbeats unless a heartbeat cadence was asked for', async () => {
		// Node-locked products have no lease to renew; calling it would be pure noise.
		const { fetchImpl, count } = countingFetch();
		const watcher = client(fetchImpl).start({
			licenseKey: 'K',
			instanceId: 'i',
			intervalMs: 60_000,
			jitter: 0,
		});
		await vi.advanceTimersByTimeAsync(120_000);
		expect(count('/v1/heartbeat')).toBe(0);
		watcher.stop();
	});

	it('heartbeats on its own cadence for a floating product', async () => {
		const { fetchImpl, count } = countingFetch();
		const watcher = client(fetchImpl).start({
			licenseKey: 'K',
			instanceId: 'i',
			intervalMs: 600_000,
			heartbeatMs: 60_000,
			jitter: 0,
		});
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(180_000);
		expect(count('/v1/heartbeat')).toBe(3);
		// The slower verify cadence is unaffected by the heartbeat one.
		expect(count('/v1/validate')).toBe(1);
		watcher.stop();
	});

	it('swallows a network failure instead of throwing into the app', async () => {
		// This is the §8 case. A refresh that fails is inconclusive, and the app should
		// carry on with its cached token rather than seeing an exception.
		const { fetchImpl } = countingFetch({ failVerify: true });
		const errors: unknown[] = [];
		const results: unknown[] = [];
		const watcher = client(fetchImpl).start({
			licenseKey: 'K',
			instanceId: 'i',
			intervalMs: 60_000,
			jitter: 0,
			onResult: (r) => results.push(r),
			onError: (e) => errors.push(e),
		});
		await expect(vi.advanceTimersByTimeAsync(0)).resolves.not.toThrow();
		// A network failure is reported as an inconclusive result, not an error.
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ inconclusive: true, offline: true });
		expect(errors).toHaveLength(0);
		watcher.stop();
	});

	it('keeps scheduling after a failure rather than giving up', async () => {
		const { fetchImpl, count } = countingFetch({ failVerify: true });
		const watcher = client(fetchImpl).start({
			licenseKey: 'K',
			instanceId: 'i',
			intervalMs: 60_000,
			jitter: 0,
		});
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(180_000);
		expect(count('/v1/validate')).toBeGreaterThanOrEqual(3);
		watcher.stop();
	});

	it('stops cleanly, and stopping twice is harmless', async () => {
		const { fetchImpl, count } = countingFetch();
		const watcher = client(fetchImpl).start({
			licenseKey: 'K',
			instanceId: 'i',
			intervalMs: 60_000,
			heartbeatMs: 10_000,
			jitter: 0,
		});
		await vi.advanceTimersByTimeAsync(0);
		const afterFirst = count('/v1/validate');
		watcher.stop();
		expect(() => watcher.stop()).not.toThrow();
		await vi.advanceTimersByTimeAsync(600_000);
		expect(count('/v1/validate')).toBe(afterFirst);
		expect(count('/v1/heartbeat')).toBe(0);
	});
});

describe('heartbeat()', () => {
	it('returns the renewed lease expiry', async () => {
		const { fetchImpl } = countingFetch();
		const cb = client(fetchImpl);
		const lease = await cb.heartbeat('K', { instanceId: 'i' });
		expect(lease).toBe('2027-01-01T00:00:00Z');
	});

	it('reports a null lease distinctly, so a caller can tell held from not renewed', async () => {
		// null means nothing was renewed: unknown instance, lapsed lease with no free seat,
		// or a node-locked product. Flattening that into a boolean loses the difference.
		const fetchImpl = (async () =>
			new Response(JSON.stringify({ ok: true, lease_expires_at: null }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})) as typeof fetch;
		const lease = await client(fetchImpl).heartbeat('K', { instanceId: 'i' });
		expect(lease).toBeNull();
	});
});
