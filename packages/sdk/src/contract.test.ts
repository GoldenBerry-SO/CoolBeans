// ABOUTME: The shared access-state contract (#77) — the same cases the Swift SDK runs, so the two
// ABOUTME: cannot drift on which states deny and which keep a paying customer working.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoolBeans } from './index.js';
import { base64url, memStorage } from './test/server.js';

// URLs rather than node:path: this package ships to browsers and its tsconfig carries no
// Node path types, which is the right default for the library.
const CANONICAL = new URL('../../../contract/access-states.json', import.meta.url);
/** Where every SDK repo keeps its copy, relative to this one. */
const SWIFT_COPY = new URL(
	'../../../../coolbeans-swift/Tests/CoolBeansTests/access-states.json',
	import.meta.url,
);

interface TokenSpec {
	status: 'active' | 'disabled';
	kind: 'perpetual' | 'subscription' | 'trial';
	/** Seconds from T0 to the licence's end, or null for a licence that has none. */
	expiresIn: number | null;
	/** The token's own lifetime in seconds. */
	ttl: number;
	entitlements?: Record<string, boolean | number | string>;
}

interface ContractCase {
	name: string;
	token: TokenSpec | null;
	revoked?: boolean;
	steps: number[];
	expect: {
		decision: 'allow' | 'deny';
		reason: string;
		entitlements?: Record<string, boolean | number | string> | null;
	};
}

const contract = JSON.parse(readFileSync(CANONICAL, 'utf8')) as {
	version: number;
	product: string;
	instance: string;
	cases: ContractCase[];
};

const T0 = new Date('2026-03-01T00:00:00Z').getTime();

/** Sign a token the way the server would, and hand back the keyset that verifies it. */
async function signed(spec: TokenSpec, product: string, instance: string) {
	const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
		'sign',
		'verify',
	])) as CryptoKeyPair;
	const iat = Math.floor(T0 / 1000);
	const payload = {
		key: 'CONT-A2B3-C4D5-E6F7-G8H9',
		status: spec.status,
		kind: spec.kind,
		plan: null,
		product,
		expires_at: spec.expiresIn === null ? null : new Date(T0 + spec.expiresIn * 1000).toISOString(),
		...(spec.entitlements ? { entitlements: spec.entitlements } : {}),
		instance_id: instance,
		iat,
		exp: iat + spec.ttl,
	};
	const header = base64url(
		new TextEncoder().encode(JSON.stringify({ alg: 'EdDSA', typ: 'CBT', kid: 'c1' })),
	);
	const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
	const input = new TextEncoder().encode(`${header}.${body}`);
	const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, input));
	return {
		token: `${header}.${body}.${base64url(sig)}`,
		keys: {
			c1: base64url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))),
		},
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(T0));
});

afterEach(() => {
	vi.useRealTimers();
});

describe(`access-state contract v${contract.version}`, () => {
	for (const testCase of contract.cases) {
		it(testCase.name, async () => {
			const storage = memStorage();
			if (testCase.token) {
				const { token, keys } = await signed(testCase.token, contract.product, contract.instance);
				storage.setItem('coolbeans.token', token);
				storage.setItem('coolbeans.instance_id', contract.instance);
				storage.setItem('coolbeans.pubkeys', JSON.stringify(keys));
			}
			if (testCase.revoked) storage.setItem('coolbeans.revoked', '1');

			// Every evaluation is offline: these cases are about what the SDK concludes from what
			// it already holds, which is exactly where a lockout bug hides.
			const cb = new CoolBeans({
				product: contract.product,
				storage,
				fetch: (() => {
					throw new TypeError('fetch failed');
				}) as unknown as typeof fetch,
			});

			let state = await cb.open();
			for (const step of testCase.steps) {
				vi.setSystemTime(new Date(Date.now() + step * 1000));
				state = await cb.open();
			}
			cb.stop();

			expect(state.decision, testCase.name).toBe(testCase.expect.decision);
			expect(state.reason, testCase.name).toBe(testCase.expect.reason);
			if ('entitlements' in testCase.expect) {
				expect(state.entitlements ?? null).toEqual(testCase.expect.entitlements ?? null);
			}
		});
	}

	it('covers every reason either SDK can return', () => {
		// A reason nobody has a case for is a reason nobody has agreed on.
		const covered = new Set(contract.cases.map((c) => c.expect.reason));
		for (const reason of ['online', 'cached', 'grace', 'clock_rollback']) {
			// `online` is the one reason these offline cases cannot produce, and it is the one
			// state that is definitionally not in dispute.
			if (reason === 'online') continue;
			expect([...covered], reason).toContain(reason);
		}
		for (const reason of ['revoked', 'expired', 'uninitialized']) {
			expect([...covered], reason).toContain(reason);
		}
	});

	it('is byte-identical in the Swift SDK', () => {
		// Both SDKs running the same cases is what stops behavioural drift; identical copies is
		// what stops one repo quietly testing an older contract. Skipped, loudly, when the
		// sibling checkout is not here — CI for this repo does not have it.
		if (!existsSync(SWIFT_COPY)) {
			console.warn(`[contract] ../coolbeans-swift not present, copy check skipped: ${SWIFT_COPY}`);
			return;
		}
		const digest = (file: URL) =>
			createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
		expect(
			digest(SWIFT_COPY),
			'copy the canonical contract/access-states.json into the Swift SDK',
		).toBe(digest(CANONICAL));
	});
});
