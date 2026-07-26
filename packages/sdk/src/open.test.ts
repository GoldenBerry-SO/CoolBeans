// ABOUTME: open() tests (#74) — the one launch call, and the verdict an app cannot misread.
// ABOUTME: A canned server mints real signed tokens so offline, grace and clock cases are honest.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoolBeans } from './index.js';
import { fakeServer, LICENSE_KEY as KEY, memStorage } from './test/server.js';

let server: Awaited<ReturnType<typeof fakeServer>>;
let storage: ReturnType<typeof memStorage>;
let cb: CoolBeans;

beforeEach(async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
	server = await fakeServer();
	storage = memStorage();
	cb = new CoolBeans({ storage, fetch: server.doFetch });
});

afterEach(() => {
	vi.useRealTimers();
});

/** Days from the frozen test clock, as an ISO string. */
function inDays(days: number): string {
	return new Date(Date.now() + days * 86_400_000).toISOString();
}

describe('open() on the happy path', () => {
	it('activates on first run and validates on later runs, with no app-side instance id', async () => {
		const first = await cb.open(KEY);
		expect(first.decision).toBe('allow');
		expect(first.reason).toBe('online');
		expect(server.calls).toContain('/v1/activate');

		server.calls.length = 0;
		const second = await cb.open(KEY);
		expect(second.decision).toBe('allow');
		expect(second.reason).toBe('online');
		// A second activate would burn another seat on every launch.
		expect(server.calls).not.toContain('/v1/activate');
		expect(server.calls).toContain('/v1/validate');
	});

	it('carries the licence for display, with kind and plan', async () => {
		server.cfg.expiresAt = inDays(30);
		const state = await cb.open(KEY);
		expect(state.license).toMatchObject({
			key: KEY,
			kind: 'subscription',
			plan: 'Pro monthly',
			product: 'clementine',
		});
		expect(state.decision === 'allow' && state.expiresAt).toBe(server.cfg.expiresAt);
	});
});

describe('open() when the network is gone', () => {
	it('returns allow/cached from the stored token', async () => {
		await cb.open(KEY);
		server.cfg.offline = true;
		const state = await cb.open(KEY);
		expect(state).toMatchObject({ decision: 'allow', reason: 'cached' });
		// Still readable for display while offline.
		expect(state.license?.plan).toBe('Pro monthly');
	});

	it('returns allow/grace past the token TTL but inside the signed expiry', async () => {
		server.cfg.expiresAt = inDays(30);
		await cb.open(KEY);
		server.cfg.offline = true;
		vi.setSystemTime(new Date(Date.now() + 2 * 3600 * 1000));
		const state = await cb.open(KEY);
		expect(state).toMatchObject({ decision: 'allow', reason: 'grace' });
	});

	it('returns deny/uninitialized on a first run with no token, never revoked or expired', async () => {
		server.cfg.offline = true;
		const state = await cb.open(KEY);
		expect(state).toMatchObject({ decision: 'deny', reason: 'uninitialized', license: null });
	});

	it('keeps the last allow when the licence was revoked while offline', async () => {
		await cb.open(KEY);
		// Revoked server-side, but the app cannot hear about it.
		server.cfg.status = 'disabled';
		server.cfg.offline = true;
		const state = await cb.open(KEY);
		expect(state.decision).toBe('allow');
	});

	it('denies once the signed expiry has passed, even with no network', async () => {
		server.cfg.expiresAt = inDays(3);
		await cb.open(KEY);
		server.cfg.offline = true;
		vi.setSystemTime(new Date(Date.now() + 4 * 86_400_000));
		const state = await cb.open(KEY);
		expect(state).toMatchObject({ decision: 'deny', reason: 'expired' });
	});
});

describe('open() when the answer is definitive', () => {
	it('returns deny/revoked on a fetched disabled licence and erases the token', async () => {
		await cb.open(KEY);
		server.cfg.status = 'disabled';
		const state = await cb.open(KEY);
		expect(state).toMatchObject({ decision: 'deny', reason: 'revoked' });
		expect(state.license?.status).toBe('disabled');
		// The cached token must not survive to unlock the app on the next launch.
		expect(await cb.verifyOffline()).toBe(false);
	});

	it('stays revoked offline after a fetched revocation, rather than looking uninitialized', async () => {
		await cb.open(KEY);
		server.cfg.status = 'disabled';
		await cb.open(KEY);
		server.cfg.offline = true;
		const state = await cb.open(KEY);
		expect(state).toMatchObject({ decision: 'deny', reason: 'revoked' });
	});

	it('clears an earlier revocation when the licence comes back', async () => {
		await cb.open(KEY);
		server.cfg.status = 'disabled';
		await cb.open(KEY);
		server.cfg.status = 'active';
		expect(await cb.open(KEY)).toMatchObject({ decision: 'allow', reason: 'online' });
		server.cfg.offline = true;
		expect((await cb.open(KEY)).decision).toBe('allow');
	});

	it('recovers when the seat was deactivated remotely', async () => {
		await cb.open(KEY);
		// The vendor freed this device's seat: validate is conclusive but not valid.
		server.deactivateAll();
		server.calls.length = 0;
		const state = await cb.open(KEY);
		expect(server.calls).toContain('/v1/activate');
		// Re-activation took a fresh seat, so access is restored rather than denied.
		expect(state).toMatchObject({ decision: 'allow', reason: 'online' });
	});

	it('keeps the old allow when the network drops during re-activation', async () => {
		await cb.open(KEY);
		server.deactivateAll();
		// Let activate through, then pull the plug before the seat can be proven.
		let calls = 0;
		const flaky = ((url: string | URL | Request, init?: RequestInit) => {
			if (new URL(String(url)).pathname === '/v1/validate' && ++calls > 1) {
				throw new TypeError('fetch failed');
			}
			return server.doFetch(url, init);
		}) as typeof fetch;
		const flakyCb = new CoolBeans({ storage, fetch: flaky });
		// A half-finished re-activation must not read as a device we have never seen.
		expect((await flakyCb.open(KEY)).decision).toBe('allow');
	});
});

describe('open() without being handed the key again', () => {
	it('reuses the key inside the cached token on later launches', async () => {
		await cb.open(KEY);
		server.calls.length = 0;
		expect(await cb.open()).toMatchObject({ decision: 'allow', reason: 'online' });
		expect(server.calls).toContain('/v1/validate');
	});

	it('is uninitialized when there is no key and nothing cached', async () => {
		expect(await cb.open()).toMatchObject({ decision: 'deny', reason: 'uninitialized' });
	});
});

describe('open() and a lying clock', () => {
	it('cannot be given more licence by moving the clock back', async () => {
		server.cfg.expiresAt = inDays(3);
		await cb.open(KEY);
		server.cfg.offline = true;
		// Drift past the expiry so the floor records the later time.
		vi.setSystemTime(new Date(Date.now() + 4 * 86_400_000));
		expect((await cb.open(KEY)).reason).toBe('expired');
		// Now wind the clock back to before the licence ended.
		vi.setSystemTime(new Date(Date.now() - 10 * 86_400_000));
		expect((await cb.open(KEY)).decision).toBe('deny');
	});

	it('reports allow/clock_rollback when the clock went back but the licence still holds', async () => {
		server.cfg.expiresAt = inDays(30);
		await cb.open(KEY);
		server.cfg.offline = true;
		vi.setSystemTime(new Date(Date.now() - 5 * 86_400_000));
		expect(await cb.open(KEY)).toMatchObject({ decision: 'allow', reason: 'clock_rollback' });
	});

	it('clears the penalty after a successful validation', async () => {
		await cb.open(KEY);
		server.cfg.offline = true;
		// Far future, then back: the floor is now years ahead of the real clock.
		vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
		await cb.open(KEY);
		vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
		expect((await cb.open(KEY)).reason).toBe('clock_rollback');

		// A server that answers is the authority on what time it is not.
		server.cfg.offline = false;
		expect((await cb.open(KEY)).reason).toBe('online');
		server.cfg.offline = true;
		expect(await cb.open(KEY)).toMatchObject({ decision: 'allow', reason: 'cached' });
	});
});

describe('open() alongside the older surface', () => {
	it('leaves verify and verifyOffline working on the state open established', async () => {
		await cb.open(KEY);
		const instanceId = cb.instanceId();
		expect(instanceId).toBeTruthy();
		const result = await cb.verify(KEY, { instanceId: instanceId as string });
		expect(result).toMatchObject({ valid: true, inconclusive: false });
		expect(await cb.verifyOffline()).toBe(true);
		expect(await cb.offlineState()).toBe('valid');
	});
});
