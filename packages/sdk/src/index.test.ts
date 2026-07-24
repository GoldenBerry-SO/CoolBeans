// ABOUTME: SDK tests (PRD §11) — activate/verify/deactivate, offline tolerance, and token states.
// ABOUTME: A canned fetch drives the §9 shapes; offline tokens are signed with WebCrypto in-test.

import { describe, expect, it } from 'vitest';
import { CoolBeans, CoolBeansError } from './index.js';
import type { TokenPayload } from './token.js';

function base64url(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function signToken(payload: TokenPayload, kid: string) {
	const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
		'sign',
		'verify',
	])) as CryptoKeyPair;
	const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
	const header = base64url(
		new TextEncoder().encode(JSON.stringify({ alg: 'EdDSA', typ: 'CBT', kid })),
	);
	const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
	const input = new TextEncoder().encode(`${header}.${body}`);
	const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, input));
	return { token: `${header}.${body}.${base64url(sig)}`, publicKeys: { [kid]: base64url(rawPub) } };
}

function payloadOf(overrides: Partial<TokenPayload> = {}): TokenPayload {
	const now = Math.floor(Date.now() / 1000);
	return {
		key: 'CLEM-A2B3-C4D5-E6F7-G8H9',
		status: 'active',
		kind: 'subscription',
		plan: null,
		product: 'clementine',
		expires_at: null,
		instance_id: 'i',
		iat: now,
		exp: now + 3600,
		...overrides,
	};
}

function memStorage() {
	const m = new Map<string, string>();
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
	};
}

function cannedFetch(handler: (path: string, body: unknown) => { status: number; json: unknown }) {
	return (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const path = new URL(String(url)).pathname;
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		const { status, json } = handler(path, body);
		return new Response(JSON.stringify(json), {
			status,
			headers: { 'Content-Type': 'application/json' },
		});
	}) as typeof fetch;
}

describe('CoolBeans SDK', () => {
	it('fingerprint is stable across calls', () => {
		const cb = new CoolBeans({ product: 'clementine', storage: memStorage() });
		expect(cb.fingerprint()).toBe(cb.fingerprint());
	});

	it('activate returns the license and instance', async () => {
		const cb = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			fetch: cannedFetch(() => ({
				status: 200,
				json: {
					ok: true,
					license: {
						key: 'CLEM-...',
						status: 'active',
						kind: 'subscription',
						product: 'clementine',
						expires_at: null,
					},
					instance: { id: 'inst_1', name: 'Mac' },
				},
			})),
		});
		const { instance } = await cb.activate('CLEM-A2B3-C4D5-E6F7-G8H9', { name: 'Mac' });
		expect(instance.id).toBe('inst_1');
	});

	it('activate fails closed on a product mismatch', async () => {
		const cb = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			fetch: cannedFetch(() => ({
				status: 200,
				json: {
					ok: true,
					license: {
						key: 'HEX-...',
						status: 'active',
						kind: 'subscription',
						product: 'hexis',
						expires_at: null,
					},
					instance: { id: 'inst_1', name: 'Mac' },
				},
			})),
		});
		await expect(cb.activate('HEX-A2B3-C4D5-E6F7-G8H9')).rejects.toBeInstanceOf(CoolBeansError);
	});

	it('drops the cached offline token when the server says disabled', async () => {
		const storage = memStorage();
		const cached = await signToken(payloadOf(), '1');
		storage.setItem('coolbeans.token', cached.token);
		const cb = new CoolBeans({
			product: 'clementine',
			storage,
			publicKeys: cached.publicKeys,
			fetch: cannedFetch(() => ({
				status: 200,
				json: {
					ok: true,
					valid: false,
					license: {
						key: 'CLEM-…',
						status: 'disabled',
						kind: 'subscription',
						product: 'clementine',
						expires_at: null,
					},
					instance: null,
				},
			})),
		});
		expect(await cb.verifyOffline()).toBe(true); // cached token still unlocks pre-verify
		const res = await cb.verify('CLEM-A2B3-C4D5-E6F7-G8H9', { instanceId: 'i' });
		expect(res.valid).toBe(false);
		expect(res.inconclusive).toBe(false);
		// The definitive disabled signal cleared the cache: offline no longer unlocks.
		expect(await cb.verifyOffline()).toBe(false);
	});

	it('verify never hard-locks on a network error (offline + inconclusive)', async () => {
		const cb = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			fetch: (async () => {
				throw new Error('network down');
			}) as unknown as typeof fetch,
		});
		const res = await cb.verify('CLEM-A2B3-C4D5-E6F7-G8H9', { instanceId: 'inst_1' });
		expect(res.offline).toBe(true);
		expect(res.inconclusive).toBe(true);
	});

	it('404/5xx are inconclusive and leave the cached token alone', async () => {
		const storage = memStorage();
		const cached = await signToken(payloadOf(), '1');
		storage.setItem('coolbeans.token', cached.token);
		const cb = new CoolBeans({
			product: 'clementine',
			storage,
			publicKeys: cached.publicKeys,
			fetch: cannedFetch(() => ({
				status: 404,
				json: { ok: false, error: 'unknown_key', message: 'nope' },
			})),
		});
		const res = await cb.verify('CLEM-A2B3-C4D5-E6F7-G8H9', { instanceId: 'i' });
		expect(res.inconclusive).toBe(true);
		expect(res.offline).toBe(false);
		// Inconclusive is never a lockout: the cached token still unlocks offline.
		expect(await cb.verifyOffline()).toBe(true);
	});

	it('verifyOffline reports valid within TTL, grace past TTL for non-trial', async () => {
		const now = Math.floor(Date.now() / 1000);
		const active = await signToken(payloadOf(), '1');
		const cb = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			publicKeys: active.publicKeys,
		});
		(cb as unknown as { storage: ReturnType<typeof memStorage> }).storage.setItem(
			'coolbeans.token',
			active.token,
		);
		expect(await cb.offlineState()).toBe('valid');

		const expired = await signToken(payloadOf({ iat: now - 7200, exp: now - 3600 }), '2');
		const cb2 = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			publicKeys: expired.publicKeys,
		});
		(cb2 as unknown as { storage: ReturnType<typeof memStorage> }).storage.setItem(
			'coolbeans.token',
			expired.token,
		);
		expect(await cb2.offlineState()).toBe('grace');
	});

	it('a paid licence past its own signed expiry is expired offline, not in grace', async () => {
		// The token itself says the licence ended. That is a definitive statement we signed,
		// not an inconclusive network answer, so honouring it leaves §8 intact — and it is
		// what makes subscription revocation work for someone who has gone offline.
		const now = Math.floor(Date.now() / 1000);
		const lapsed = await signToken(
			payloadOf({
				kind: 'subscription',
				expires_at: new Date((now - 86_400) * 1000).toISOString(),
			}),
			'exp1',
		);
		const cb = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			publicKeys: lapsed.publicKeys,
		});
		(cb as unknown as { storage: ReturnType<typeof memStorage> }).storage.setItem(
			'coolbeans.token',
			lapsed.token,
		);
		// TTL is still live, so the old rule would have said 'valid'.
		expect(await cb.offlineState()).toBe('expired');
		expect(await cb.verifyOffline()).toBe(false);
	});

	it('a paid licence with a future expiry still gets grace past the token TTL', async () => {
		// Grace on TTL is the §8 promise and must survive: a network failure alone never
		// locks anyone out.
		const now = Math.floor(Date.now() / 1000);
		const stale = await signToken(
			payloadOf({
				kind: 'subscription',
				expires_at: new Date((now + 86_400 * 30) * 1000).toISOString(),
				iat: now - 7200,
				exp: now - 3600,
			}),
			'exp2',
		);
		const cb = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			publicKeys: stale.publicKeys,
		});
		(cb as unknown as { storage: ReturnType<typeof memStorage> }).storage.setItem(
			'coolbeans.token',
			stale.token,
		);
		expect(await cb.offlineState()).toBe('grace');
		expect(await cb.verifyOffline()).toBe(true);
	});

	it('a lifetime licence carries no expiry and keeps its unbounded grace', async () => {
		const now = Math.floor(Date.now() / 1000);
		const lifetime = await signToken(
			payloadOf({ kind: 'perpetual', expires_at: null, iat: now - 7200, exp: now - 3600 }),
			'exp3',
		);
		const cb = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			publicKeys: lifetime.publicKeys,
		});
		(cb as unknown as { storage: ReturnType<typeof memStorage> }).storage.setItem(
			'coolbeans.token',
			lifetime.token,
		);
		expect(await cb.offlineState()).toBe('grace');
	});

	it('offline treats a disabled-status token as expired', async () => {
		const disabled = await signToken(payloadOf({ status: 'disabled' }), '3');
		const cb = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			publicKeys: disabled.publicKeys,
		});
		(cb as unknown as { storage: ReturnType<typeof memStorage> }).storage.setItem(
			'coolbeans.token',
			disabled.token,
		);
		expect(await cb.offlineState()).toBe('expired');
	});

	it('a trial token past its trial expiry gets NO grace (enforced expiry)', async () => {
		const now = Math.floor(Date.now() / 1000);
		const trial = await signToken(
			payloadOf({
				kind: 'trial',
				expires_at: new Date((now - 60) * 1000).toISOString(),
				iat: now - 7200,
				exp: now - 60,
			}),
			'1',
		);
		const cb = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			publicKeys: trial.publicKeys,
		});
		(cb as unknown as { storage: ReturnType<typeof memStorage> }).storage.setItem(
			'coolbeans.token',
			trial.token,
		);
		expect(await cb.offlineState()).toBe('expired');
		expect(await cb.verifyOffline()).toBe(false);
	});

	it('fails closed offline when no trusted keys exist (no unsigned fallback)', async () => {
		const forged = await signToken(payloadOf(), '1');
		const cb = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			// No embedded keys, and key fetch fails (offline).
			fetch: (async () => {
				throw new Error('offline');
			}) as unknown as typeof fetch,
		});
		(cb as unknown as { storage: ReturnType<typeof memStorage> }).storage.setItem(
			'coolbeans.token',
			forged.token,
		);
		expect(await cb.offlineState()).toBe('expired');
	});

	it('rejects a token bound to a different instance (copied-token defense)', async () => {
		const stolen = await signToken(payloadOf({ instance_id: 'someone-elses-device' }), '1');
		const storage = memStorage();
		storage.setItem('coolbeans.token', stolen.token);
		storage.setItem('coolbeans.instance_id', 'my-device');
		const cb = new CoolBeans({ product: 'clementine', storage, publicKeys: stolen.publicKeys });
		expect(await cb.offlineState()).toBe('expired');
	});

	it('rejects a token for a different product', async () => {
		const other = await signToken(payloadOf({ product: 'hexis' }), '1');
		const cb = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			publicKeys: other.publicKeys,
		});
		(cb as unknown as { storage: ReturnType<typeof memStorage> }).storage.setItem(
			'coolbeans.token',
			other.token,
		);
		expect(await cb.offlineState()).toBe('expired');
	});

	it('refreshes an unknown rotated key while verify is already online', async () => {
		const old = await signToken(payloadOf(), 'old-kid');
		const rotated = await signToken(payloadOf(), 'new-kid');
		const storage = memStorage();
		let fetches = 0;
		const cb = new CoolBeans({
			product: 'clementine',
			storage,
			publicKeys: old.publicKeys,
			fetch: cannedFetch((path) => {
				if (path === '/v1/pubkey') {
					fetches++;
					return { status: 200, json: { ok: true, keys: rotated.publicKeys } };
				}
				return {
					status: 200,
					json: {
						ok: true,
						valid: true,
						license: {
							key: 'CLEM-A2B3-C4D5-E6F7-G8H9',
							status: 'active',
							kind: 'subscription',
							product: 'clementine',
							expires_at: null,
						},
						instance: { id: 'i', name: 'device' },
						token: rotated.token,
					},
				};
			}),
		});
		await cb.verify('CLEM-A2B3-C4D5-E6F7-G8H9', { instanceId: 'i' });
		expect(await cb.offlineState()).toBe('valid');
		expect(fetches).toBe(1);
		// Keys persisted: local checks need no further fetch.
		expect(await cb.offlineState()).toBe('valid');
		expect(fetches).toBe(1);
	});
});

describe('SDK hardening (issue #45)', () => {
	it('warns loudly when a non-browser host gets ephemeral storage', () => {
		const warnings: string[] = [];
		const original = console.warn;
		console.warn = (msg: string) => warnings.push(String(msg));
		try {
			// No localStorage and no injected storage: the device id would be reborn on
			// every restart, silently burning a seat each time.
			new CoolBeans({ product: 'clementine', baseUrl: 'https://keys.test' });
		} finally {
			console.warn = original;
		}
		expect(warnings.join(' ')).toMatch(/storage/i);
	});

	it('verifyOffline never touches the network', async () => {
		let called = false;
		const storage = memStorage();
		// A cached token without its signing key used to make offlineState fetch /pubkey.
		// The local-only contract must hold even on this unknown-kid path.
		storage.setItem('coolbeans.token', 'eyJraWQiOiJ1bmtub3duIn0.e30.invalid');
		const client = new CoolBeans({
			product: 'clementine',
			baseUrl: 'https://keys.test',
			storage,
			fetch: (async () => {
				called = true;
				throw new Error('verifyOffline must not fetch');
			}) as unknown as typeof fetch,
		});
		await client.verifyOffline();
		expect(called).toBe(false);
	});

	it('deactivate reports failure instead of pretending the seat was freed', async () => {
		const client = new CoolBeans({
			product: 'clementine',
			baseUrl: 'https://keys.test',
			storage: memStorage(),
			fetch: (async () =>
				new Response(JSON.stringify({ ok: false, error: 'unknown_key' }), {
					status: 404,
					headers: { 'Content-Type': 'application/json' },
				})) as unknown as typeof fetch,
		});
		await expect(
			client.deactivate('CLEM-AAAA-BBBB-CCCC-DDDD', { instanceId: 'inst-1' }),
		).rejects.toThrow();
	});
});
