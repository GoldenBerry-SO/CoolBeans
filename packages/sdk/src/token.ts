// ABOUTME: Offline token verification for the SDK (PRD §11) — Ed25519 via WebCrypto, no network.
// ABOUTME: Works in the browser and in Node/Electron/Tauri; verifies the server-signed token locally.

export interface TokenPayload {
	key: string;
	status: 'active' | 'disabled';
	tier: 'lifetime' | 'yearly' | 'trial';
	product: string;
	expires_at: string | null;
	instance_id: string;
	iat: number;
	exp: number;
}

function fromBase64Url(s: string): Uint8Array {
	const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
	const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export interface DecodedToken {
	header: { alg: string; kid: string };
	payload: TokenPayload;
	signingInput: Uint8Array;
	signature: Uint8Array;
}

/** Decode a compact token into its parts without verifying. */
export function decodeToken(token: string): DecodedToken | null {
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	try {
		const header = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
		const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
		return {
			header,
			payload,
			signingInput: new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
			signature: fromBase64Url(parts[2]),
		};
	} catch {
		return null;
	}
}

/** Verify a token's Ed25519 signature against public keys keyed by kid. Returns the payload or null. */
export async function verifyTokenSignature(
	token: string,
	publicKeysByKid: Record<string, string>,
): Promise<TokenPayload | null> {
	const decoded = decodeToken(token);
	if (!decoded) return null;
	const publicKeyB64 = publicKeysByKid[decoded.header.kid];
	if (!publicKeyB64) return null;
	try {
		const key = await crypto.subtle.importKey(
			'raw',
			fromBase64Url(publicKeyB64) as unknown as ArrayBuffer,
			{ name: 'Ed25519' },
			false,
			['verify'],
		);
		const ok = await crypto.subtle.verify(
			{ name: 'Ed25519' },
			key,
			decoded.signature as unknown as ArrayBuffer,
			decoded.signingInput as unknown as ArrayBuffer,
		);
		return ok ? decoded.payload : null;
	} catch {
		return null;
	}
}
