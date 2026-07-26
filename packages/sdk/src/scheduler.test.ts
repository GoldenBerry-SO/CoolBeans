// ABOUTME: The SDK's own upkeep (#75) — refresh cadence, floating leases, and onChange.
// ABOUTME: A failed refresh must never throw into the app or disturb the cached token.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AccessState, CoolBeans } from './index.js';
import { base64url, fakeServer, LICENSE_KEY as KEY, memStorage } from './test/server.js';

/** Captured before any fake-timer install, for the tests that need the real thing. */
const setTimeoutOriginal = globalThis.setTimeout;

/**
 * One turn of the real event loop plus a microtask flush. Signing and verifying tokens go
 * through WebCrypto, which resolves off a threadpool that fake timers do not drive, so a check
 * started by a fake timer needs real turns to finish. Advancing 0ms flushes what awaits it.
 */
async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeoutOriginal(resolve, 0));
	await vi.advanceTimersByTimeAsync(0);
}

/** Move the fake clock, then let anything it started run to completion. */
async function tick(ms: number): Promise<void> {
	await vi.advanceTimersByTimeAsync(ms);
	for (let i = 0; i < 8; i++) await settle();
}

/**
 * Wait for something the background loop does, without pinning how many event-loop turns it
 * takes — that varies with machine load, and a count assertion that races it is a flaky test.
 * The fake clock does not move here, so a timer due later still cannot fire: this waits for
 * work already released, never for the next tick.
 */
async function until(condition: () => boolean, what: string): Promise<void> {
	for (let i = 0; i < 500; i++) {
		if (condition()) return;
		await settle();
	}
	throw new Error(`timed out waiting for ${what}`);
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
						kind: 'subscription',
						plan: null,
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

/** Sign an offline-activation blob the way the server would, with a throwaway key. */
async function signOffline(overrides: Record<string, unknown> = {}) {
	const now = Math.floor(Date.now() / 1000);
	const payload = {
		key: 'CLEM-A2B3-C4D5-E6F7-G8H9',
		status: 'active',
		kind: 'perpetual',
		plan: null,
		product: 'clementine',
		expires_at: null,
		instance_id: 'machine-1',
		iat: now,
		exp: now + 365 * 86_400,
		...overrides,
	};
	const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
		'sign',
		'verify',
	])) as CryptoKeyPair;
	const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
	const header = base64url(
		new TextEncoder().encode(JSON.stringify({ alg: 'EdDSA', typ: 'CBT', kid: 'off' })),
	);
	const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
	const input = new TextEncoder().encode(`${header}.${body}`);
	const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, input));
	return { token: `${header}.${body}.${base64url(sig)}`, publicKeys: { off: base64url(rawPub) } };
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

describe('open() keeps itself fresh (#75)', () => {
	const MINUTE = 60_000;
	/** A third of the fake server's hour-long token, which is the default refresh cadence. */
	const REFRESH = 20 * MINUTE;

	let server: Awaited<ReturnType<typeof fakeServer>>;
	let cb: CoolBeans;

	beforeEach(async () => {
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		server = await fakeServer();
		cb = new CoolBeans({ storage: memStorage(), fetch: server.doFetch });
	});

	afterEach(() => {
		cb.stop();
	});

	it('holds a floating lease with no app-side scheduling, at a third of the window', async () => {
		// The app is told nothing about lease windows and picks no interval. The server's own
		// lease_expires_at sets the cadence, so a dropped beat has two more before the seat goes.
		server.cfg.leaseMs = 30 * MINUTE;
		await cb.open(KEY, { jitter: 0 });
		expect(server.count('/v1/heartbeat')).toBe(1);

		// Not eager either: a third of a thirty minute window is ten minutes, not nine.
		await tick(9 * MINUTE);
		expect(server.count('/v1/heartbeat')).toBe(1);
		await tick(MINUTE);
		await until(() => server.count('/v1/heartbeat') === 2, 'the second beat');
		await tick(10 * MINUTE);
		await until(() => server.count('/v1/heartbeat') === 3, 'the third beat');
	});

	it('never heartbeats again once the product turns out to be node-locked', async () => {
		// A null lease is the server saying there is nothing to renew. One probe learns that;
		// scheduling anything after it is pure noise, forever.
		server.cfg.leaseMs = null;
		await cb.open(KEY, { jitter: 0 });
		expect(server.count('/v1/heartbeat')).toBe(1);
		await tick(4 * 60 * MINUTE);
		expect(server.count('/v1/heartbeat')).toBe(1);
	});

	it('refreshes on its own at a third of the token lifetime', async () => {
		await cb.open(KEY, { jitter: 0 });
		expect(server.count('/v1/validate')).toBe(1);
		await tick(REFRESH);
		await until(() => server.count('/v1/validate') === 2, 'the first refresh');
		await tick(REFRESH);
		await until(() => server.count('/v1/validate') === 3, 'the second refresh');
	});

	it('spreads the refresh with jitter so installs do not all wake together', async () => {
		// Every copy of an app checking on the same tick is a thundering herd against one server.
		const early = new CoolBeans({ storage: memStorage(), fetch: server.doFetch });
		await early.open(KEY, { jitter: 0.5, random: () => 0 });
		const before = server.count('/v1/validate');
		// At the low end of the window the next check has already fired at half the interval.
		await tick(REFRESH / 2);
		await until(() => server.count('/v1/validate') === before + 1, 'the early refresh');
		early.stop();
	});

	it('keeps the last good state when a refresh fails, rather than denying', async () => {
		const seen: AccessState[] = [];
		expect(await cb.open(KEY, { jitter: 0, onChange: (s) => seen.push(s) })).toMatchObject({
			decision: 'allow',
			reason: 'online',
		});
		server.cfg.offline = true;
		await tick(REFRESH);
		await until(() => seen.length === 1, 'the offline verdict');
		// Working from cache is worth saying once, but it is never a lockout.
		expect(seen.map((s) => `${s.decision}/${s.reason}`)).toEqual(['allow/cached']);
		// And it keeps trying rather than giving up after one failure.
		const tries = server.count('/v1/validate');
		await tick(2 * REFRESH);
		expect(server.count('/v1/validate')).toBeGreaterThan(tries);
		expect(seen.every((s) => s.decision === 'allow')).toBe(true);
	});

	it('calls onChange when the verdict changes, not on every tick', async () => {
		const seen: AccessState[] = [];
		await cb.open(KEY, { jitter: 0, onChange: (s) => seen.push(s) });
		// Three healthy refreshes say exactly what open() already returned.
		await tick(3 * REFRESH);
		expect(seen).toHaveLength(0);

		server.cfg.status = 'disabled';
		await tick(REFRESH);
		await until(() => seen.length === 1, 'the revocation');
		expect(seen[0]).toMatchObject({ decision: 'deny', reason: 'revoked' });

		// And it does not keep repeating the bad news on every tick after that.
		await tick(3 * REFRESH);
		expect(seen).toHaveLength(1);
	});

	it('reports an upgrade that changes only the capabilities', async () => {
		// The docs promise a capability can move between tiers with no app release. That only holds
		// if a running app hears about it: on a Basic-to-Pro upgrade the decision and the reason
		// are both unchanged, so comparing those alone leaves 4k export switched off until the
		// user happens to restart.
		server.cfg.entitlements = { export_4k: false };
		const seen: AccessState[] = [];
		await cb.open(KEY, { jitter: 0, onChange: (s) => seen.push(s) });
		server.cfg.entitlements = { export_4k: true };
		await tick(REFRESH);
		await until(() => seen.length === 1, 'the upgrade');
		expect(seen[0]?.entitlements).toEqual({ export_4k: true });
	});

	it('does not report a tick that changed nothing, capabilities included', async () => {
		server.cfg.entitlements = { export_4k: true, batch_limit: 100 };
		const seen: AccessState[] = [];
		await cb.open(KEY, { jitter: 0, onChange: (s) => seen.push(s) });
		await tick(3 * REFRESH);
		expect(seen).toHaveLength(0);
	});

	it('holds the seat again after the refresh takes a fresh one', async () => {
		// A floating seat freed from the console makes the heartbeat answer null, which is also how
		// a node-locked product answers — so the beat loop stops. The refresh then re-activates.
		// Without reopening the lease question the new seat is never held either, so it lapses,
		// gets re-activated, lapses again: the app looks fine while the seat churns forever.
		server.cfg.leaseMs = 30 * MINUTE;
		await cb.open(KEY, { jitter: 0 });
		server.deactivateAll();

		// The beat at ten minutes finds no seat and gives up.
		await tick(10 * MINUTE);
		const afterLapse = server.count('/v1/heartbeat');

		// The refresh at twenty takes a fresh seat.
		await tick(10 * MINUTE);
		await until(() => server.count('/v1/activate') === 2, 're-activation');

		// Which must start the beats again.
		await tick(10 * MINUTE);
		await until(() => server.count('/v1/heartbeat') > afterLapse, 'the seat being held again');
	});

	it('keeps the handler when a later open() does not pass one', async () => {
		// An app registers onChange on launch and then calls open(key) again when the user pastes a
		// key, often from another module that has no handler to hand. Dropping it there means
		// revocations stop reaching a running app, silently. Swift keeps it; so does this.
		const seen: AccessState[] = [];
		await cb.open(KEY, { jitter: 0, onChange: (s) => seen.push(s) });
		await cb.open(KEY, { jitter: 0 });
		server.cfg.status = 'disabled';
		await tick(REFRESH);
		await until(() => seen.length === 1, 'the revocation');
		expect(seen[0]).toMatchObject({ decision: 'deny', reason: 'revoked' });
	});

	it('stops cleanly, and stopping twice is harmless', async () => {
		server.cfg.leaseMs = 30 * MINUTE;
		await cb.open(KEY, { jitter: 0 });
		const validates = server.count('/v1/validate');
		const beats = server.count('/v1/heartbeat');
		cb.stop();
		expect(() => cb.stop()).not.toThrow();
		await tick(10 * 60 * MINUTE);
		expect(server.count('/v1/validate')).toBe(validates);
		expect(server.count('/v1/heartbeat')).toBe(beats);
	});

	it('opening twice does not leave two loops running', async () => {
		await cb.open(KEY, { jitter: 0 });
		await cb.open(KEY, { jitter: 0 });
		const after = server.count('/v1/validate');
		await tick(REFRESH);
		await until(() => server.count('/v1/validate') > after, 'the refresh');
		// One refresh, not one per open() call.
		expect(server.count('/v1/validate')).toBe(after + 1);
	});

	it('does not hold a CLI process open waiting for the next refresh', async () => {
		// A tool that opens, prints and exits must exit. A referenced 20-minute timer would
		// keep Node's event loop alive that whole time.
		vi.useRealTimers();
		const handles: Array<{ hasRef?: () => boolean }> = [];
		const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
			fn: () => void,
			ms?: number,
		) => {
			const handle = setTimeoutOriginal(fn, ms);
			handles.push(handle as unknown as { hasRef?: () => boolean });
			return handle;
		}) as unknown as typeof setTimeout);
		try {
			await cb.open(KEY, { jitter: 0 });
			const scheduled = handles.filter((h) => typeof h.hasRef === 'function');
			expect(scheduled.length).toBeGreaterThan(0);
			expect(scheduled.every((h) => h.hasRef?.() === false)).toBe(true);
		} finally {
			spy.mockRestore();
			cb.stop();
			vi.useFakeTimers();
		}
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

describe('importActivation()', () => {
	it('unlocks from a pasted blob with no network at all', async () => {
		// The whole point: this machine has never made a request and never will.
		const storage = memStorage();
		storage.setItem('coolbeans.device_id', 'MACHINE-A');
		const { token, publicKeys } = await signOffline({
			instance_id: 'machine-1',
			fingerprint: 'MACHINE-A',
		});
		const cb = new CoolBeans({
			product: 'clementine',
			storage,
			publicKeys,
			fetch: (() => {
				throw new Error('no network should be touched');
			}) as unknown as typeof fetch,
		});
		await cb.importActivation(token);
		expect(await cb.offlineState()).toBe('valid');
		expect(cb.instanceId()).toBe('machine-1');
	});

	it('refuses a blob minted for a different machine', async () => {
		// Without the signed fingerprint the only device-specific value is the instance id
		// the token itself supplies, so the check is circular and one blob unlocks every
		// machine it is pasted into. This is the whole reason the claim exists.
		const storage = memStorage();
		storage.setItem('coolbeans.device_id', 'MACHINE-B');
		const { token, publicKeys } = await signOffline({ fingerprint: 'MACHINE-A' });
		const cb = new CoolBeans({ product: 'clementine', storage, publicKeys });
		await expect(cb.importActivation(token)).rejects.toThrow(/different machine/);
		expect(await cb.verifyOffline()).toBe(false);
	});

	it('refuses a blob carrying no fingerprint at all', async () => {
		// An unbound blob is exactly what the check exists to stop, so it must not read as
		// "nothing to verify, therefore fine".
		const storage = memStorage();
		storage.setItem('coolbeans.device_id', 'MACHINE-A');
		const { token, publicKeys } = await signOffline({});
		const cb = new CoolBeans({ product: 'clementine', storage, publicKeys });
		await expect(cb.importActivation(token)).rejects.toThrow(/not bound to a machine/);
		expect(await cb.verifyOffline()).toBe(false);
	});

	it('rejects a blob for a different product', async () => {
		const { token, publicKeys } = await signOffline({ product: 'somebody-else' });
		const cb = new CoolBeans({ product: 'clementine', storage: memStorage(), publicKeys });
		await expect(cb.importActivation(token)).rejects.toThrow();
		expect(await cb.verifyOffline()).toBe(false);
	});

	it('rejects a blob whose signature does not verify', async () => {
		// A forged or edited blob is the obvious attack when the token is handed around
		// as text.
		const { token } = await signOffline({});
		const other = await signOffline({});
		const tampered = `${token.split('.').slice(0, 2).join('.')}.${other.token.split('.')[2]}`;
		const cb = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			publicKeys: (await signOffline({})).publicKeys,
		});
		await expect(cb.importActivation(tampered)).rejects.toThrow();
	});

	it('rejects a blob that is already expired', async () => {
		const now = Math.floor(Date.now() / 1000);
		const { token, publicKeys } = await signOffline({ iat: now - 7200, exp: now - 3600 });
		const cb = new CoolBeans({ product: 'clementine', storage: memStorage(), publicKeys });
		await expect(cb.importActivation(token)).rejects.toThrow();
	});
});

describe('error messages', () => {
	it('surfaces the reason rather than a generic request failure', async () => {
		// importActivation makes no request at all, so "request failed" was both unhelpful
		// and untrue. Callers show these to people.
		const { token, publicKeys } = await signOffline({ product: 'somebody-else' });
		const cb = new CoolBeans({ product: 'clementine', storage: memStorage(), publicKeys });
		await expect(cb.importActivation(token)).rejects.toThrow(/different product/);
	});

	it('keeps a status-shaped message when the server sent no sentence', async () => {
		const fetchImpl = (async () =>
			new Response(JSON.stringify({ ok: false }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			})) as typeof fetch;
		await expect(client(fetchImpl).deactivate('K', { instanceId: 'i' })).rejects.toThrow(/500/);
	});
});
