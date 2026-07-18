// ABOUTME: @coolbeans/sdk (PRD §11) — drop-in licensing for Node, Electron, Tauri, and the browser.
// ABOUTME: The key is the credential; offline-tolerant by contract, only `disabled` revokes access.

import { type TokenPayload, verifyTokenSignature } from './token.js';

export type { TokenPayload };

export interface LicenseObject {
	key: string;
	status: 'active' | 'disabled';
	tier: 'lifetime' | 'yearly' | 'trial';
	product: string;
	expires_at: string | null;
}

export interface InstanceObject {
	id: string;
	name: string;
}

/** Minimal persistent storage the SDK uses for the device id, cached token, and trusted keys. */
export interface Storage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface CoolBeansOptions {
	product: string;
	/** Base URL of the Cool Beans server. Defaults to the hosted cloud. */
	baseUrl?: string;
	/**
	 * Public keys keyed by kid, embedded in the app (PRD §11 recommends bundling them).
	 * Keys fetched from /v1/pubkey are persisted to storage and merged with these.
	 */
	publicKeys?: Record<string, string>;
	/** Persistent storage. Defaults to localStorage in the browser, in-memory elsewhere. */
	storage?: Storage;
	/** Injectable fetch for tests. */
	fetch?: typeof fetch;
}

export type OfflineState = 'valid' | 'grace' | 'expired';

export interface ActivateResult {
	license: LicenseObject;
	instance: InstanceObject;
}

export interface VerifyResult {
	valid: boolean;
	license: LicenseObject | null;
	instance: InstanceObject | null;
	token: string | null;
	/** True when the server could not be reached (network failure). */
	offline: boolean;
	/**
	 * True when the answer is NOT definitive (network failure, non-200, malformed body,
	 * or product mismatch). Per the frozen contract, an inconclusive answer must never
	 * lock the user out — fall back to verifyOffline(). Only an explicit
	 * `license.status === "disabled"` with `inconclusive: false` revokes access.
	 */
	inconclusive: boolean;
}

const DEFAULT_BASE = 'https://app.coolbeans.tools';
const DEVICE_KEY = 'coolbeans.device_id';
const TOKEN_KEY = 'coolbeans.token';
const KEYS_KEY = 'coolbeans.pubkeys';
const INSTANCE_KEY = 'coolbeans.instance_id';

function memoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => {
			map.set(k, v);
		},
	};
}

function defaultStorage(): Storage {
	// Browsers get durable storage automatically; Node/Electron callers should inject
	// their own. Falling back to memory silently would mint a new device id on every
	// restart and burn a seat each time, so say so loudly once.
	const ls = (globalThis as { localStorage?: Storage }).localStorage;
	if (ls) return ls;
	console.warn(
		'[coolbeans] No localStorage found and no storage option was passed, so this client is using in-memory storage. The device id and cached token will be lost on restart, and each restart consumes another activation seat. Pass a durable `storage` (for example one backed by a file or Electron store).',
	);
	return memoryStorage();
}

export class CoolBeans {
	private readonly product: string;
	private readonly baseUrl: string;
	private readonly storage: Storage;
	private readonly doFetch: typeof fetch;
	private readonly embeddedKeys: Record<string, string> | null;

	constructor(opts: CoolBeansOptions) {
		this.product = opts.product;
		this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
		this.storage = opts.storage ?? defaultStorage();
		this.doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
		this.embeddedKeys = opts.publicKeys ?? null;
	}

	/** A stable per-install device id, persisted in storage. */
	fingerprint(): string {
		let id = this.storage.getItem(DEVICE_KEY);
		if (!id) {
			id = crypto.randomUUID();
			this.storage.setItem(DEVICE_KEY, id);
		}
		return id;
	}

	/** The instance id from the last successful activate on this device, if any. */
	instanceId(): string | null {
		return this.storage.getItem(INSTANCE_KEY);
	}

	/** Activate this device. Fails closed if the returned product does not match. */
	async activate(licenseKey: string, opts: { name?: string } = {}): Promise<ActivateResult> {
		const body = { license_key: licenseKey, instance_name: opts.name ?? this.fingerprint() };
		const res = await this.post('/v1/activate', body);
		const data = (await res.json()) as {
			ok: boolean;
			license: LicenseObject;
			instance: InstanceObject;
		};
		if (!res.ok || !data.ok) throw new CoolBeansError(res.status, data);
		if (data.license.product !== this.product) {
			throw new CoolBeansError(res.status, { error: 'product_mismatch' });
		}
		this.storage.setItem(INSTANCE_KEY, data.instance.id);
		return { license: data.license, instance: data.instance };
	}

	/**
	 * Verify online, refreshing the cached offline token. Anything short of a definitive
	 * 200 answer for this product is inconclusive and never a lockout.
	 */
	async verify(licenseKey: string, opts: { instanceId: string }): Promise<VerifyResult> {
		const inconclusive = (offline: boolean): VerifyResult => ({
			valid: false,
			license: null,
			instance: null,
			token: null,
			offline,
			inconclusive: true,
		});

		let res: Response;
		try {
			res = await this.post('/v1/validate', {
				license_key: licenseKey,
				instance_id: opts.instanceId,
			});
		} catch {
			return inconclusive(true);
		}

		let data: {
			ok?: boolean;
			valid?: boolean;
			license?: LicenseObject | null;
			instance?: InstanceObject | null;
			token?: string;
		};
		try {
			data = (await res.json()) as typeof data;
		} catch {
			return inconclusive(false);
		}

		// 404/422/429/5xx and malformed bodies are inconclusive per the frozen contract.
		if (res.status !== 200 || !data.ok || !data.license) return inconclusive(false);
		// A definitive answer about some other product is not an answer about this one.
		if (data.license.product !== this.product) return inconclusive(false);

		if (data.token) {
			this.storage.setItem(TOKEN_KEY, data.token);
			this.storage.setItem(INSTANCE_KEY, opts.instanceId);
			// Best effort while we are already online: fetch when there is no keyset or the
			// returned token uses a rotated/unknown key. offlineState itself never fetches.
			const keys = this.trustedKeys();
			if (!keys || !(await verifyTokenSignature(data.token, keys))) await this.refreshKeys();
		}
		// The definitive revocation signal: drop the cached token so verifyOffline stops unlocking.
		if (data.license.status === 'disabled') this.storage.setItem(TOKEN_KEY, '');

		return {
			valid: !!data.valid,
			license: data.license,
			instance: data.instance ?? null,
			token: data.token ?? null,
			offline: false,
			inconclusive: false,
		};
	}

	/** Local, no-network check of the cached token. True to unlock (valid or grace). */
	async verifyOffline(): Promise<boolean> {
		return (await this.offlineState()) !== 'expired';
	}

	/** Detailed offline state: valid (within TTL), grace (past TTL, active), or expired/revoked. */
	async offlineState(): Promise<OfflineState> {
		const token = this.storage.getItem(TOKEN_KEY);
		if (!token) return 'expired';

		// Only signature-verified tokens count. No trusted keys -> fail closed: the token
		// came from a verify() that also persisted the keyset, so this only bites tampering.
		const keys = this.trustedKeys();
		// This method is deliberately network-free. Online verify() refreshes missing
		// keysets; an offline caller with no matching trusted key must fail closed locally.
		const payload = keys ? await verifyTokenSignature(token, keys) : null;
		if (!payload) return 'expired';

		// Claim binding: the token must be for this product and this device's instance.
		if (payload.product !== this.product) return 'expired';
		const boundInstance = this.storage.getItem(INSTANCE_KEY);
		if (boundInstance && payload.instance_id !== boundInstance) return 'expired';

		if (payload.status === 'disabled') return 'expired';

		const now = Date.now();
		if (payload.tier === 'trial') {
			// Trial expiry is enforced (§9): no grace period can outlive the trial itself.
			if (payload.expires_at && new Date(payload.expires_at).getTime() <= now) return 'expired';
			if (payload.exp * 1000 <= now) return 'expired';
			return 'valid';
		}
		return payload.exp * 1000 > now ? 'valid' : 'grace';
	}

	/** Free a seat. Idempotent server-side. */
	async deactivate(licenseKey: string, opts: { instanceId: string }): Promise<void> {
		const res = await this.post('/v1/deactivate', {
			license_key: licenseKey,
			instance_id: opts.instanceId,
		});
		// The server is idempotent about already-freed seats, so a non-2xx here means the
		// call genuinely did not happen. Resolving anyway would tell the caller a seat was
		// freed when it was not, and they would stop retrying.
		if (!res.ok) {
			throw new CoolBeansError(res.status, await res.json().catch(() => null));
		}
	}

	/** Embedded keys merged with any keyset persisted from a previous fetch. */
	private trustedKeys(): Record<string, string> | null {
		let stored: Record<string, string> = {};
		try {
			stored = JSON.parse(this.storage.getItem(KEYS_KEY) ?? '{}') as Record<string, string>;
		} catch {
			stored = {};
		}
		const merged = { ...stored, ...(this.embeddedKeys ?? {}) };
		return Object.keys(merged).length > 0 ? merged : null;
	}

	/** Fetch the product keyset and persist it. Returns true when new keys were stored. */
	private async refreshKeys(): Promise<boolean> {
		try {
			const res = await this.doFetch(
				`${this.baseUrl}/v1/pubkey?product=${encodeURIComponent(this.product)}`,
			);
			const data = (await res.json()) as { ok: boolean; keys: Record<string, string> };
			if (res.ok && data.ok && data.keys && Object.keys(data.keys).length > 0) {
				this.storage.setItem(KEYS_KEY, JSON.stringify(data.keys));
				return true;
			}
		} catch {
			// Offline: no keys available this call.
		}
		return false;
	}

	private post(path: string, body: unknown): Promise<Response> {
		return this.doFetch(`${this.baseUrl}${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
	}
}

export class CoolBeansError extends Error {
	constructor(
		readonly status: number,
		readonly body: unknown,
	) {
		super(`Cool Beans request failed (${status})`);
		this.name = 'CoolBeansError';
	}
}
