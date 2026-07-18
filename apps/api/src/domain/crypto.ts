// ABOUTME: At-rest encryption for signing private keys (PRD §11, §19) — AES-256-GCM.
// ABOUTME: The key is derived from SIGNING_KEY_SECRET via HKDF-SHA256 so one env secret is enough.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const KEY_LEN = 32;
const IV_LEN = 12;
const INFO = 'coolbeans-signing-key-aead';

function deriveKey(secret: string): Buffer {
	// Salt is fixed and public; the secret provides the entropy. HKDF isolates this purpose.
	return Buffer.from(hkdfSync('sha256', secret, 'coolbeans', INFO, KEY_LEN));
}

/** Encrypt plaintext to a compact `iv.ciphertext.tag` base64url triple. */
export function encryptSecret(plaintext: string, secret: string): string {
	const key = deriveKey(secret);
	const iv = randomBytes(IV_LEN);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [iv, ct, tag].map((b) => b.toString('base64url')).join('.');
}

/** Decrypt a value produced by encryptSecret. Throws if the secret is wrong or data tampered. */
export function decryptSecret(encoded: string, secret: string): string {
	const [ivB64, ctB64, tagB64] = encoded.split('.');
	if (!ivB64 || !ctB64 || !tagB64) throw new Error('Malformed ciphertext');
	const key = deriveKey(secret);
	const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
	decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
	return Buffer.concat([
		decipher.update(Buffer.from(ctB64, 'base64url')),
		decipher.final(),
	]).toString('utf8');
}
