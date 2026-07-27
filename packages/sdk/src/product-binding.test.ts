// ABOUTME: The product boundary when no slug was declared (Codex P1/P2 on #73) — a licence for one
// ABOUTME: product must not unlock another, and an offline blob must still import.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoolBeans } from './index.js';
import { base64url, fakeServer, LICENSE_KEY as KEY, memStorage } from './test/server.js';

let server: Awaited<ReturnType<typeof fakeServer>>;
let storage: ReturnType<typeof memStorage>;

beforeEach(async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
	server = await fakeServer();
	storage = memStorage();
});

afterEach(() => {
	vi.useRealTimers();
});

/** A second product on the same server, as a multi-product vendor has. */
const OTHER_KEY = 'OTHR-Z9Y8-X7W6-V5T4-S3R2';

/**
 * A server that answers for whichever product the key belongs to, which is what the real one
 * does: it resolves the product from the key's prefix, not from anything the app said.
 */
function twoProductServer() {
	return (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
		const isOther = body.license_key === OTHER_KEY;
		if (!isOther) return server.doFetch(url, init);
		// The other product's answers. No token: this test is about the boundary, and a real
		// token would be signed by the other product's key anyway.
		const path = new URL(String(url)).pathname;
		const license = {
			key: OTHER_KEY,
			status: 'active',
			kind: 'perpetual',
			plan: null,
			product: 'other-app',
			expires_at: null,
		};
		const json = (payload: unknown) =>
			new Response(JSON.stringify(payload), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		if (path === '/v1/activate') {
			return json({ ok: true, license, instance: { id: 'other-1', name: 'Mac' } });
		}
		if (path === '/v1/validate') {
			return json({ ok: true, valid: true, license, instance: { id: 'other-1', name: 'Mac' } });
		}
		return json({ ok: true });
	}) as typeof fetch;
}

describe('a licence for another product cannot unlock this app', () => {
	it('binds to the product it first activated, even with no slug declared', async () => {
		const cb = new CoolBeans({ storage, fetch: twoProductServer() });
		expect(await cb.open(KEY)).toMatchObject({ decision: 'allow' });
		cb.stop();

		// Same install, now handed a key for the vendor's other product. It must do nothing.
		const state = await cb.open(OTHER_KEY);
		cb.stop();
		expect(state.license?.product).not.toBe('other-app');
		// And the app is still running on the licence it does have, not locked out for asking.
		expect(state.decision).toBe('allow');
		expect(state.license?.product).toBe('clementine');
	});

	it('survives a restart, because the binding is persisted not remembered', async () => {
		const first = new CoolBeans({ storage, fetch: twoProductServer() });
		await first.open(KEY);
		first.stop();

		const restarted = new CoolBeans({ storage, fetch: twoProductServer() });
		const state = await restarted.open(OTHER_KEY);
		restarted.stop();
		expect(state.license?.product).toBe('clementine');
	});

	it('refuses to activate a foreign key outright, so a key-entry screen can say why', async () => {
		const cb = new CoolBeans({ storage, fetch: twoProductServer() });
		await cb.open(KEY);
		cb.stop();
		await expect(cb.activate(OTHER_KEY)).rejects.toThrow(/different product/i);
	});

	it('lets a signed-out install take a key for a different product', async () => {
		// Binding is not a life sentence: releasing the seat gives the install back its choice.
		const cb = new CoolBeans({ storage, fetch: twoProductServer() });
		await cb.open(KEY);
		await cb.release();
		const state = await cb.open(OTHER_KEY);
		cb.stop();
		expect(state.license?.product).toBe('other-app');
	});
});

describe('importActivation with no declared product', () => {
	/** Sign an offline-activation blob the way the server would, under its own kid. */
	async function blob(product: string, fingerprint: string, kid = 'off') {
		const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
			'sign',
			'verify',
		])) as CryptoKeyPair;
		const now = Math.floor(Date.now() / 1000);
		const header = base64url(
			new TextEncoder().encode(JSON.stringify({ alg: 'EdDSA', typ: 'CBT', kid })),
		);
		const body = base64url(
			new TextEncoder().encode(
				JSON.stringify({
					key: KEY,
					status: 'active',
					kind: 'perpetual',
					plan: null,
					product,
					expires_at: null,
					fingerprint,
					instance_id: 'air-gapped-1',
					iat: now,
					exp: now + 365 * 86_400,
				}),
			),
		);
		const input = new TextEncoder().encode(`${header}.${body}`);
		const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, input));
		return {
			token: `${header}.${body}.${base64url(sig)}`,
			publicKeys: {
				[kid]: base64url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))),
			},
		};
	}

	it('accepts a valid blob, rather than reading undefined as a mismatch', async () => {
		// The README and every example now configure no slug. Comparing a real product to
		// undefined refused every blob on the one flow that has no other way in.
		storage.setItem('coolbeans.device_id', 'MACHINE-A');
		const signed = await blob('clementine', 'MACHINE-A');
		const cb = new CoolBeans({ storage, publicKeys: signed.publicKeys });
		await cb.importActivation(signed.token);
		expect(await cb.verifyOffline()).toBe(true);
	});

	it('still refuses a blob for another product once this install is bound', async () => {
		storage.setItem('coolbeans.device_id', 'MACHINE-A');
		// Distinct kids, as two real products have: each has its own signing keypair.
		const mine = await blob('clementine', 'MACHINE-A', 'mine');
		const theirs = await blob('other-app', 'MACHINE-A', 'theirs');
		const cb = new CoolBeans({
			storage,
			publicKeys: { ...mine.publicKeys, ...theirs.publicKeys },
		});
		await cb.importActivation(mine.token);
		await expect(cb.importActivation(theirs.token)).rejects.toThrow(/different product/i);
	});

	it('still refuses a blob for another product when a slug was declared', async () => {
		storage.setItem('coolbeans.device_id', 'MACHINE-A');
		const signed = await blob('other-app', 'MACHINE-A');
		const cb = new CoolBeans({
			product: 'clementine',
			storage,
			publicKeys: signed.publicKeys,
		});
		await expect(cb.importActivation(signed.token)).rejects.toThrow(/different product/i);
	});
});
