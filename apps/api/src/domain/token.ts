// ABOUTME: Ed25519 offline tokens (PRD §11) — a JWT-style compact structure signed server-side.
// ABOUTME: Keys are raw JWK (x/d, base64url) so the SDK can verify with WebCrypto and no network.

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

export interface TokenPayload {
	key: string;
	status: 'active' | 'disabled';
	tier: 'lifetime' | 'yearly' | 'trial';
	product: string;
	expires_at: string | null;
	/**
	 * The device an offline activation was minted for. Present only on that path, and the
	 * only thing tying a hand-carried blob to one machine — without it a client can merely
	 * compare the token to the instance id the token itself supplied.
	 */
	fingerprint?: string;
	instance_id: string;
	iat: number;
	exp: number;
}

export interface SigningKeyPair {
	/** Raw public key, base64url (JWK `x`) — this is what apps embed. */
	publicKey: string;
	/** Raw private scalar, base64url (JWK `d`) — encrypted at rest server-side. */
	privateKey: string;
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url').replace(/=+$/, '');

/** Generate a fresh Ed25519 keypair in raw-JWK form. */
export function generateSigningKeyPair(): SigningKeyPair {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const pubJwk = publicKey.export({ format: 'jwk' }) as { x: string };
	const privJwk = privateKey.export({ format: 'jwk' }) as { d: string };
	return { publicKey: pubJwk.x, privateKey: privJwk.d };
}

function privateKeyObject(pair: SigningKeyPair) {
	return createPrivateKey({
		format: 'jwk',
		key: { kty: 'OKP', crv: 'Ed25519', x: pair.publicKey, d: pair.privateKey },
	});
}

function publicKeyObject(publicKeyB64: string) {
	return createPublicKey({
		format: 'jwk',
		key: { kty: 'OKP', crv: 'Ed25519', x: publicKeyB64 },
	});
}

/** Sign a payload into a compact `header.payload.signature` token. `kid` identifies the key. */
export function signToken(payload: TokenPayload, pair: SigningKeyPair, kid: string): string {
	const header = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'CBT', kid }));
	const body = b64url(JSON.stringify(payload));
	const signingInput = `${header}.${body}`;
	const signature = sign(null, Buffer.from(signingInput), privateKeyObject(pair));
	return `${signingInput}.${b64url(signature)}`;
}

export interface TokenHeader {
	alg: string;
	kid: string;
}

/** Decode a token's header without verifying (to pick the verification key). */
export function decodeTokenHeader(token: string): TokenHeader | null {
	const part = token.split('.')[0];
	if (!part) return null;
	try {
		return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as TokenHeader;
	} catch {
		return null;
	}
}

/**
 * Verify a token against a set of public keys keyed by kid. Returns the payload if the
 * signature is valid (TTL is the caller's concern), else null.
 */
export function verifyToken(
	token: string,
	publicKeysByKid: Record<string, string>,
): TokenPayload | null {
	const [header, body, sig] = token.split('.');
	if (!header || !body || !sig) return null;
	const parsedHeader = decodeTokenHeader(token);
	if (!parsedHeader) return null;
	const publicKeyB64 = publicKeysByKid[parsedHeader.kid];
	if (!publicKeyB64) return null;
	try {
		const ok = verify(
			null,
			Buffer.from(`${header}.${body}`),
			publicKeyObject(publicKeyB64),
			Buffer.from(sig, 'base64url'),
		);
		if (!ok) return null;
		return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
	} catch {
		return null;
	}
}
