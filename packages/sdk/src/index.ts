// ABOUTME: @coolbeans/sdk (PRD §11) — drop-in licensing for Node, Electron, Tauri, and the browser.
// ABOUTME: The key is the credential; offline-tolerant by contract, only `disabled` revokes access.

import { decodeToken, type TokenPayload, verifyTokenSignature } from './token.js';

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

/** Minimal persistent storage the SDK uses for the device id and cached token. */
export interface Storage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface CoolBeansOptions {
	product: string;
	/** Base URL of the Cool Beans server. Defaults to the hosted cloud. */
	baseUrl?: string;
	/** Public keys keyed by kid, embedded in the app. If omitted, fetched from /v1/pubkey and cached. */
	publicKeys?: Record<string, string>;
	/** Persistent storage (localStorage in the browser, a file-backed shim in Electron/Tauri). */
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
	/** True when the call could not reach the server (offline). Never a lockout. */
	offline: boolean;
}

const DEFAULT_BASE = 'https://app.coolbeans.tools';
const DEVICE_KEY = 'coolbeans.device_id';
const TOKEN_KEY = 'coolbeans.token';

function memoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => {
			map.set(k, v);
		},
	};
}

export class CoolBeans {
	private readonly product: string;
	private readonly baseUrl: string;
	private readonly storage: Storage;
	private readonly doFetch: typeof fetch;
	private publicKeys: Record<string, string> | null;

	constructor(opts: CoolBeansOptions) {
		this.product = opts.product;
		this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
		this.storage = opts.storage ?? memoryStorage();
		this.doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
		this.publicKeys = opts.publicKeys ?? null;
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
		return { license: data.license, instance: data.instance };
	}

	/** Verify online, refreshing the cached offline token. Offline errors never hard-lock. */
	async verify(licenseKey: string, opts: { instanceId: string }): Promise<VerifyResult> {
		let res: Response;
		try {
			res = await this.post('/v1/validate', {
				license_key: licenseKey,
				instance_id: opts.instanceId,
			});
		} catch {
			// Network failure: inconclusive, never a lockout.
			return { valid: false, license: null, instance: null, token: null, offline: true };
		}
		const data = (await res.json()) as {
			ok: boolean;
			valid: boolean;
			license: LicenseObject | null;
			instance: InstanceObject | null;
			token?: string;
		};
		if (data.token) this.storage.setItem(TOKEN_KEY, data.token);
		return {
			valid: !!data.valid,
			license: data.license ?? null,
			instance: data.instance ?? null,
			token: data.token ?? null,
			offline: false,
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
		const keys = await this.getPublicKeys();
		if (!keys) {
			// Cannot fetch keys and none embedded — fall back to unverified decode within TTL only.
			const decoded = decodeToken(token);
			if (!decoded || decoded.payload.status === 'disabled') return 'expired';
			return decoded.payload.exp * 1000 > Date.now() ? 'grace' : 'expired';
		}
		const payload = await verifyTokenSignature(token, keys);
		if (!payload || payload.status === 'disabled') return 'expired';
		return payload.exp * 1000 > Date.now() ? 'valid' : 'grace';
	}

	/** Free a seat. Idempotent server-side. */
	async deactivate(licenseKey: string, opts: { instanceId: string }): Promise<void> {
		await this.post('/v1/deactivate', { license_key: licenseKey, instance_id: opts.instanceId });
	}

	private async getPublicKeys(): Promise<Record<string, string> | null> {
		if (this.publicKeys) return this.publicKeys;
		try {
			const res = await this.doFetch(
				`${this.baseUrl}/v1/pubkey?product=${encodeURIComponent(this.product)}`,
			);
			const data = (await res.json()) as { ok: boolean; keys: Record<string, string> };
			if (data.ok) {
				this.publicKeys = data.keys;
				return data.keys;
			}
		} catch {
			// Offline: no keys available this call.
		}
		return null;
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
