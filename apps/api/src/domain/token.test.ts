// ABOUTME: Offline-token tests (PRD §11) — Ed25519 sign/verify round-trip and rotation behavior.
// ABOUTME: A token verifies only against its own key; a wrong/absent kid fails closed.

import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto.js';
import { generateSigningKeyPair, signToken, type TokenPayload, verifyToken } from './token.js';

function samplePayload(): TokenPayload {
	return {
		key: 'CLEM-A2B3-C4D5-E6F7-G8H9',
		status: 'active',
		kind: 'subscription',
		plan: null,
		product: 'clementine',
		expires_at: '2027-07-17T00:00:00.000Z',
		instance_id: 'inst_1',
		iat: 1_000,
		exp: 1_000 + 7 * 86_400,
	};
}

describe('offline tokens', () => {
	it('signs and verifies with the matching public key', async () => {
		const pair = generateSigningKeyPair();
		const token = signToken(samplePayload(), pair, '1');
		const payload = verifyToken(token, { '1': pair.publicKey });
		expect(payload?.product).toBe('clementine');
		expect(payload?.instance_id).toBe('inst_1');
	});

	it('rejects a token signed by a different key', async () => {
		const a = generateSigningKeyPair();
		const b = generateSigningKeyPair();
		const token = signToken(samplePayload(), a, '1');
		expect(verifyToken(token, { '1': b.publicKey })).toBeNull();
	});

	it('rejects a token whose kid is not in the key set', async () => {
		const pair = generateSigningKeyPair();
		const token = signToken(samplePayload(), pair, '2');
		expect(verifyToken(token, { '1': pair.publicKey })).toBeNull();
	});

	it('rotation: old and new tokens both verify against the served key set', async () => {
		const oldKey = generateSigningKeyPair();
		const newKey = generateSigningKeyPair();
		const oldToken = signToken(samplePayload(), oldKey, '1');
		const newToken = signToken(samplePayload(), newKey, '2');
		const served = { '1': oldKey.publicKey, '2': newKey.publicKey };
		expect(verifyToken(oldToken, served)?.product).toBe('clementine');
		expect(verifyToken(newToken, served)?.product).toBe('clementine');
	});

	it('rejects a tampered payload', async () => {
		const pair = generateSigningKeyPair();
		const token = signToken(samplePayload(), pair, '1');
		const [h, , s] = token.split('.');
		const forged = `${h}.${Buffer.from(JSON.stringify({ ...samplePayload(), status: 'active', kind: 'perpetual' })).toString('base64url')}.${s}`;
		expect(verifyToken(forged, { '1': pair.publicKey })).toBeNull();
	});
});

describe('at-rest encryption', () => {
	it('round-trips a secret', async () => {
		const enc = encryptSecret('super-secret-private-key', 'master-secret-value');
		expect(enc).not.toContain('super-secret');
		expect(decryptSecret(enc, 'master-secret-value')).toBe('super-secret-private-key');
	});

	it('fails to decrypt with the wrong master secret', async () => {
		const enc = encryptSecret('data', 'right-secret');
		expect(() => decryptSecret(enc, 'wrong-secret')).toThrow();
	});
});
