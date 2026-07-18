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

function memStorage() {
	const m = new Map<string, string>();
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
	};
}

function cannedFetch(handler: (path: string, body: unknown) => { status: number; json: unknown }) {
	return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const path = new URL(String(url)).pathname;
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		const { status, json } = handler(path, body);
		return new Response(JSON.stringify(json), {
			status,
			headers: { 'Content-Type': 'application/json' },
		});
	};
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
						tier: 'yearly',
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
						tier: 'yearly',
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
		const now = Math.floor(Date.now() / 1000);
		const cached = await signToken(
			{
				key: 'CLEM',
				status: 'active',
				tier: 'yearly',
				product: 'clementine',
				expires_at: null,
				instance_id: 'i',
				iat: now,
				exp: now + 3600,
			},
			'1',
		);
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
						tier: 'yearly',
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
		// The definitive disabled signal cleared the cache: offline no longer unlocks.
		expect(await cb.verifyOffline()).toBe(false);
	});

	it('verify never hard-locks on a network error (offline:true)', async () => {
		const cb = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			fetch: async () => {
				throw new Error('network down');
			},
		});
		const res = await cb.verify('CLEM-A2B3-C4D5-E6F7-G8H9', { instanceId: 'inst_1' });
		expect(res.offline).toBe(true);
		expect(res.valid).toBe(false);
	});

	it('verifyOffline reports valid within TTL, grace past TTL, expired when disabled', async () => {
		const storage = memStorage();
		const now = Math.floor(Date.now() / 1000);
		const active = await signToken(
			{
				key: 'CLEM',
				status: 'active',
				tier: 'yearly',
				product: 'clementine',
				expires_at: null,
				instance_id: 'i',
				iat: now,
				exp: now + 3600,
			},
			'1',
		);
		const cb = new CoolBeans({ product: 'clementine', storage, publicKeys: active.publicKeys });
		storage.setItem('coolbeans.token', active.token);
		expect(await cb.offlineState()).toBe('valid');
		expect(await cb.verifyOffline()).toBe(true);

		const expired = await signToken(
			{
				key: 'CLEM',
				status: 'active',
				tier: 'yearly',
				product: 'clementine',
				expires_at: null,
				instance_id: 'i',
				iat: now - 7200,
				exp: now - 3600,
			},
			'2',
		);
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

		const disabled = await signToken(
			{
				key: 'CLEM',
				status: 'disabled',
				tier: 'yearly',
				product: 'clementine',
				expires_at: null,
				instance_id: 'i',
				iat: now,
				exp: now + 3600,
			},
			'3',
		);
		const cb3 = new CoolBeans({
			product: 'clementine',
			storage: memStorage(),
			publicKeys: disabled.publicKeys,
		});
		(cb3 as unknown as { storage: ReturnType<typeof memStorage> }).storage.setItem(
			'coolbeans.token',
			disabled.token,
		);
		expect(await cb3.offlineState()).toBe('expired');
	});
});
