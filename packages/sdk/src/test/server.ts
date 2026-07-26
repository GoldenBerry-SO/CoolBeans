// ABOUTME: A fake Cool Beans server for the SDK tests — real Ed25519 tokens, real seat bookkeeping.
// ABOUTME: Shared so offline, grace, clock and scheduling tests all argue with the same server.

const KEY = 'CLEM-A2B3-C4D5-E6F7-G8H9';
const KID = 'k1';

export const LICENSE_KEY = KEY;

export function base64url(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function memStorage() {
	const m = new Map<string, string>();
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
		dump: () => Object.fromEntries(m),
	};
}

/**
 * A server that behaves like the real one: activate takes a seat, validate mints a signed
 * token, and the keyset route serves the key it signed with. `cfg` is mutable so a test can
 * pull the network, disable a licence, move a renewal date, or free a seat mid-run.
 */
export async function fakeServer() {
	const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
		'sign',
		'verify',
	])) as CryptoKeyPair;
	const publicKeys = {
		[KID]: base64url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))),
	};

	const cfg = {
		offline: false,
		status: 'active' as 'active' | 'disabled',
		kind: 'subscription' as 'perpetual' | 'subscription' | 'trial',
		plan: 'Pro monthly' as string | null,
		expiresAt: null as string | null,
		/** Token lifetime, deliberately shorter than the licence so grace is reachable. */
		ttlSec: 3600,
		/**
		 * Floating lease window in ms, or null for a node-locked product — which is exactly
		 * what the real route returns for one, and how a client learns the difference.
		 */
		leaseMs: null as number | null,
		/**
		 * Capabilities signed into the token. Null means the licence has none, and the claim is
		 * left out entirely rather than sent empty — which is what the real signer does.
		 */
		entitlements: null as Record<string, boolean | number | string> | null,
	};
	const calls: string[] = [];
	/** Live seats, so a remotely freed seat behaves the way the real server behaves. */
	const seats = new Set<string>();
	let issued = 0;

	const license = () => ({
		key: KEY,
		status: cfg.status,
		kind: cfg.kind,
		plan: cfg.plan,
		product: 'clementine',
		expires_at: cfg.expiresAt,
	});

	async function mint(instanceId: string): Promise<string> {
		const now = Math.floor(Date.now() / 1000);
		const header = base64url(
			new TextEncoder().encode(JSON.stringify({ alg: 'EdDSA', typ: 'CBT', kid: KID })),
		);
		const body = base64url(
			new TextEncoder().encode(
				JSON.stringify({
					...license(),
					...(cfg.entitlements ? { entitlements: cfg.entitlements } : {}),
					instance_id: instanceId,
					iat: now,
					exp: now + cfg.ttlSec,
				}),
			),
		);
		const input = new TextEncoder().encode(`${header}.${body}`);
		const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, input));
		return `${header}.${body}.${base64url(sig)}`;
	}

	const doFetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const path = new URL(String(url)).pathname;
		calls.push(path);
		if (cfg.offline) throw new TypeError('fetch failed');
		const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
		const json = (status: number, payload: unknown) =>
			new Response(JSON.stringify(payload), {
				status,
				headers: { 'Content-Type': 'application/json' },
			});

		if (path === '/v1/activate') {
			issued += 1;
			const id = `i${issued}`;
			seats.add(id);
			return json(200, { ok: true, license: license(), instance: { id, name: 'Mac' } });
		}
		if (path === '/v1/validate') {
			const instanceId = body.instance_id as string;
			const valid = cfg.status === 'active' && seats.has(instanceId);
			return json(200, {
				ok: true,
				valid,
				license: license(),
				instance: { id: instanceId, name: 'Mac' },
				// No token when there is nothing to entitle, as the real route does.
				...(valid ? { token: await mint(instanceId) } : {}),
			});
		}
		if (path === '/v1/heartbeat') {
			// null for a node-locked product, and also for a seat we could not hold.
			const lease =
				cfg.leaseMs !== null && seats.has(body.instance_id as string)
					? new Date(Date.now() + cfg.leaseMs).toISOString()
					: null;
			return json(200, { ok: true, lease_expires_at: lease });
		}
		if (path === '/v1/keyset') {
			return json(200, { ok: true, algorithm: 'ed25519', keys: publicKeys });
		}
		return json(404, { ok: false, error: 'not_found' });
	}) as typeof fetch;

	return {
		cfg,
		calls,
		doFetch,
		publicKeys,
		/** Free every seat, as a vendor does from the console. */
		deactivateAll: () => seats.clear(),
		count: (path: string) => calls.filter((c) => c === path).length,
	};
}
