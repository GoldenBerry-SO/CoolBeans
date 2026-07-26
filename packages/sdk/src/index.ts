// ABOUTME: @coolbeans/sdk (PRD §11) — drop-in licensing for Node, Electron, Tauri, and the browser.
// ABOUTME: The key is the credential; offline-tolerant by contract, only `disabled` revokes access.

import { decodeToken, type TokenPayload, verifyTokenSignature } from './token.js';

export type { TokenPayload };

export interface LicenseObject {
	key: string;
	status: 'active' | 'disabled';
	/** Entitlement lifecycle, not pricing. Do not branch app logic on it. */
	kind: 'perpetual' | 'subscription' | 'trial';
	/** The vendor's free-form plan label (display only), or null. */
	plan: string | null;
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
	/**
	 * The product slug. Optional: activate and validate resolve the product from the key's
	 * prefix, and signing keys are fetched by licence key, so an app no longer has to know it.
	 * Supplying it adds a belt-and-braces claim check that a token is for the product expected.
	 */
	product?: string;
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

/** Why access is granted. All four unlock the app; they differ only in what to tell the user. */
export type AllowReason =
	/** The server just confirmed it. */
	| 'online'
	/** No fresh answer, but the cached token is still within its lifetime. */
	| 'cached'
	/** Past the token's lifetime and still inside the licence. Nudge them online. */
	| 'grace'
	/** The machine's clock went backwards. Access stands, evaluated against the clock floor. */
	| 'clock_rollback';

/** Why access is refused. Only these three are definitive; everything else keeps the last state. */
export type DenyReason =
	/** A fetched answer said `disabled`. The only revocation signal there is. */
	| 'revoked'
	/** A signed expiry has passed, which is our own credential saying the licence ended. */
	| 'expired'
	/** No entitlement has ever been established on this device. Ask for a key. */
	| 'uninitialized';

/**
 * The single verdict from `open()`. A discriminated union rather than a boolean, because
 * "we have never established an entitlement" must not share a name with "you were revoked":
 * one asks for a licence key, the other says the licence is gone.
 *
 * Branch access on `decision` only. `license` is for display.
 */
export type AccessState =
	| {
			decision: 'allow';
			reason: AllowReason;
			license: LicenseObject | null;
			/** The licence's own end date, null for perpetual. */
			expiresAt: string | null;
			/**
			 * What this licence buys, when the vendor priced capabilities. Signed, so it is safe
			 * to gate a feature on — unlike `license.plan`. Absent, not empty, when there are
			 * none, so `state.entitlements?.export_4k` reads false for a licence without a
			 * capability map rather than claiming there is one.
			 */
			entitlements?: Record<string, boolean | number | string>;
	  }
	| {
			decision: 'deny';
			reason: DenyReason;
			license: LicenseObject | null;
			entitlements?: Record<string, boolean | number | string>;
	  };

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

export interface OpenOptions {
	/**
	 * Called when the verdict changes after `open()` returned — a revocation arriving, the
	 * network going away, a licence lapsing. Not called for the value `open()` itself
	 * returned, and not called again while the verdict stays the same.
	 */
	onChange?: (state: AccessState) => void;
	/**
	 * Refresh cadence. Defaults to a third of the cached token's lifetime, so there are two
	 * or three chances to reconnect before a user drifts into grace. There is rarely a reason
	 * to set this.
	 */
	intervalMs?: number;
	/** Fraction of the interval to spread randomly, 0 to 1. Defaults to 0.2. */
	jitter?: number;
	/** Injectable randomness for deterministic tests. */
	random?: () => number;
}

const DEFAULT_BASE = 'https://app.coolbeans.tools';
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_JITTER = 0.2;
const DEVICE_KEY = 'coolbeans.device_id';
const TOKEN_KEY = 'coolbeans.token';
const KEYS_KEY = 'coolbeans.pubkeys';
const INSTANCE_KEY = 'coolbeans.instance_id';
const CLOCK_KEY = 'coolbeans.clock_floor';
const REVOKED_KEY = 'coolbeans.revoked';

/** The §9 licence object is exactly the display half of a token payload. */
function licenseFromPayload(payload: TokenPayload): LicenseObject {
	return {
		key: payload.key,
		status: payload.status,
		kind: payload.kind,
		plan: payload.plan,
		product: payload.product,
		expires_at: payload.expires_at,
	};
}

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
	private readonly product: string | undefined;
	private readonly baseUrl: string;
	private readonly storage: Storage;
	private readonly doFetch: typeof fetch;
	private readonly embeddedKeys: Record<string, string> | null;

	/** Background upkeep started by `open()` and cancelled by `stop()`. */
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	private leaseTimer: ReturnType<typeof setTimeout> | undefined;
	private stopped = true;
	private refreshing = false;
	private openKey: string | undefined;
	private lastState: AccessState | undefined;
	private onChange: ((state: AccessState) => void) | undefined;
	/**
	 * 'unknown' until a heartbeat has answered, 'none' for a node-locked product, otherwise
	 * the cadence in ms we hold the floating seat at. The app is never asked which it is.
	 */
	private lease: 'unknown' | 'none' | number = 'unknown';

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
		if (this.product !== undefined && data.license.product !== this.product) {
			throw new CoolBeansError(res.status, { error: 'product_mismatch' });
		}
		this.storage.setItem(INSTANCE_KEY, data.instance.id);
		return { license: data.license, instance: data.instance };
	}

	/**
	 * The one call to make on launch. Activates if this device has never been activated,
	 * refreshes when it can reach us, falls back to the cached signed token when it cannot,
	 * and returns a single verdict:
	 *
	 * ```ts
	 * const state = await license.open(licenseKey)
	 * if (state.decision === 'deny') lockOut(state)
	 * ```
	 *
	 * It exists because the alternative — hold the instance id, choose `verify` or
	 * `verifyOffline`, and read `inconclusive` correctly — is three chances to lock out a
	 * paying customer. Everything inconclusive (offline, 5xx, timeout, 404, an unknown key)
	 * keeps the last known-good state. Only a fetched `disabled` or a signed expiry denies.
	 *
	 * From here the SDK keeps itself fresh: it re-checks on its own cadence, holds a floating
	 * seat if the product has them, and reports a changed verdict through `onChange`. Call
	 * `stop()` on shutdown. Nothing it does in the background throws into your app.
	 *
	 * `verify`, `verifyOffline` and `offlineState` remain for apps that want the pieces.
	 */
	async open(licenseKey?: string, opts: OpenOptions = {}): Promise<AccessState> {
		// A second open() replaces the first rather than racing it.
		this.stop();
		this.stopped = false;
		this.onChange = opts.onChange;
		this.lease = 'unknown';
		// The cached token carries its own licence key, so an app that has opened once need
		// not store the key anywhere itself.
		this.openKey = licenseKey ?? this.cachedTokenKey();
		const state = await this.evaluate();
		this.lastState = state;
		// Take the floating seat before saying yes, so an allow means the seat is actually
		// held. One probe is also how we learn whether this product has leases at all.
		if (state.decision === 'allow') await this.holdLease();
		this.scheduleRefresh(opts);
		return state;
	}

	/**
	 * Cancel the background upkeep `open()` started. Idempotent, and safe to call without
	 * ever having opened. The cached token is untouched, so a later `open()` still unlocks
	 * offline; only the timers go away.
	 */
	stop(): void {
		this.stopped = true;
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		if (this.leaseTimer) clearTimeout(this.leaseTimer);
		this.refreshTimer = undefined;
		this.leaseTimer = undefined;
		this.onChange = undefined;
	}

	/** The current verdict, online where we can reach the server and cached where we cannot. */
	private async evaluate(): Promise<AccessState> {
		// Before anything reads the clock: record how late it has ever been on this install.
		this.rememberClock();
		const key = this.openKey ?? this.cachedTokenKey();
		const online = key ? await this.openOnline(key) : null;
		return online ?? this.offlineVerdict();
	}

	/**
	 * Re-check, tell the app if the answer moved, and schedule the next one. Never throws:
	 * a failed refresh is the inconclusive case, so the last good state stands.
	 */
	private async refreshOnce(opts: OpenOptions): Promise<void> {
		this.refreshTimer = undefined;
		if (this.stopped) return;
		// Schedule the next tick before doing any work: a slow or hung request must not stall
		// the cadence. If the previous check somehow has not finished, skip this one rather
		// than run two at once.
		this.scheduleRefresh(opts);
		if (this.refreshing) return;
		this.refreshing = true;
		try {
			const state = await this.evaluate();
			if (this.stopped) return;
			const before = this.lastState;
			this.lastState = state;
			if (!before || before.decision !== state.decision || before.reason !== state.reason) {
				this.onChange?.(state);
			}
			// Only when we never got an answer about leases. Once the cadence is known the lease
			// loop keeps itself going, and a node-locked product is done being asked.
			if (this.lease === 'unknown' && !this.leaseTimer) await this.holdLease();
		} catch {
			// evaluate() resolves network problems itself, so reaching here is something
			// unexpected. Keeping the last state is still the right answer, and rethrowing from
			// a timer callback would be an unhandled rejection in the app's process.
		} finally {
			this.refreshing = false;
		}
	}

	private scheduleRefresh(opts: OpenOptions): void {
		if (this.stopped) return;
		const jitter = opts.jitter ?? DEFAULT_JITTER;
		const random = opts.random ?? Math.random;
		const base = opts.intervalMs ?? this.defaultInterval();
		// Spread the delay so many installs of the same app do not all wake on one tick and
		// hammer a single server.
		const spread = base * jitter;
		const delay = Math.max(0, base - spread + random() * spread * 2);
		this.refreshTimer = this.later(() => void this.refreshOnce(opts), delay);
	}

	/**
	 * Hold a floating seat on the cadence the server's own lease implies — about a third of
	 * the window, so a dropped beat has two more tries before the seat lapses. The app is
	 * never asked whether its product has leases: a null `lease_expires_at` says so.
	 *
	 * Nothing here reaches the app. A missed beat costs a seat, not correctness, and the
	 * refresh loop is what notices a seat we failed to hold.
	 */
	private async holdLease(): Promise<void> {
		this.leaseTimer = undefined;
		if (this.stopped) return;
		const instanceId = this.instanceId();
		if (!this.openKey || !instanceId) return;

		let lease: string | null | undefined;
		try {
			lease = await this.heartbeat(this.openKey, { instanceId });
		} catch {
			// A failed beat is not evidence the product stopped having leases, so once we know
			// the cadence we keep to it. Giving up here would quietly lose the user's seat.
			lease = undefined;
		}
		if (this.stopped) return;

		if (lease === null) {
			// Definitive: there is nothing to renew. A node-locked product, or a seat we could
			// not hold — and the refresh loop re-activates for the second case.
			this.lease = 'none';
			return;
		}
		if (typeof lease === 'string') {
			const remaining = new Date(lease).getTime() - Date.now();
			if (Number.isFinite(remaining) && remaining > 0) {
				this.lease = Math.max(1000, remaining / 3);
			}
		}
		if (typeof this.lease !== 'number') return;
		this.leaseTimer = this.later(() => void this.holdLease(), this.lease);
	}

	/**
	 * setTimeout that does not keep a Node process alive. A CLI that opens, prints and exits
	 * has to exit, not sit on a twenty-minute timer. No-op in the browser, which has no refs.
	 */
	private later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
		const handle = setTimeout(fn, ms);
		(handle as unknown as { unref?: () => void }).unref?.();
		return handle;
	}

	/**
	 * The online half of `open()`. Returns null for every inconclusive answer, which is the
	 * caller's cue to fall back to the cached token rather than deny anything.
	 */
	private async openOnline(licenseKey: string): Promise<AccessState | null> {
		const instanceId = this.instanceId() ?? (await this.claimSeat(licenseKey));
		if (!instanceId) return null;

		let result = await this.verify(licenseKey, { instanceId });
		if (!result.inconclusive && !result.valid && result.license?.status === 'active') {
			result = (await this.reclaimSeat(licenseKey, instanceId)) ?? result;
		}
		if (result.inconclusive || !result.license) return null;

		const license = result.license;
		if (license.status === 'disabled') {
			// verify() already dropped the token. Remember that we were told, so a later launch
			// with no network says "revoked" rather than "never activated".
			this.storage.setItem(REVOKED_KEY, '1');
			return { decision: 'deny', reason: 'revoked', license };
		}
		if (result.valid) {
			// A server that answers is authoritative on both counts: the licence stands, and
			// the local clock has no penalty to serve.
			this.storage.setItem(REVOKED_KEY, '');
			this.storage.setItem(CLOCK_KEY, String(Date.now()));
			// Entitlements ride in the token, not the frozen licence object. Read from storage, so
			// a 200 that carried no token still reports what the last one said — they are
			// snapshotted at issuance and never change for a licence, so the cached copy cannot
			// be stale. Decoding rather than verifying is fine here: it arrived over the same
			// HTTPS response as the licence beside it. The offline path verifies, because there
			// the token is all there is.
			const claims = this.cachedTokenPayload();
			return {
				decision: 'allow',
				reason: 'online',
				license,
				expiresAt: license.expires_at,
				...(claims?.entitlements ? { entitlements: claims.entitlements } : {}),
			};
		}
		// Conclusive, active, still not valid. A past expiry is definitive; anything else
		// (no free seat, for instance) is not our call to turn into a lockout.
		if (license.expires_at && new Date(license.expires_at).getTime() <= this.effectiveNow()) {
			return { decision: 'deny', reason: 'expired', license };
		}
		return null;
	}

	/**
	 * A live licence that does not recognise this device: the seat was freed from the console,
	 * or storage was restored onto a machine we have no record of. Take a seat again rather
	 * than lock out someone who is paying. Returns the fresh result, or null when we learned
	 * nothing better and the caller should keep the one it has.
	 */
	private async reclaimSeat(licenseKey: string, previous: string): Promise<VerifyResult | null> {
		const fresh = await this.claimSeat(licenseKey);
		if (!fresh || fresh === previous) return null;
		const result = await this.verify(licenseKey, { instanceId: fresh });
		if (!result.inconclusive) return result;
		// The new seat is claimed but unproven, and the cached token still names the old
		// instance. Leaving the new id stored would make that token look like another device's,
		// which the offline path reads as "never activated" — a lockout on an inconclusive
		// answer, which is the one thing we must never do.
		this.storage.setItem(INSTANCE_KEY, previous);
		return null;
	}

	/**
	 * Activate and return the instance id, or null if we could not. Every failure here is
	 * inconclusive by contract — an unknown key is a 404, a full product is a 4xx, and neither
	 * revokes anything — so the error is swallowed. An app that needs the reason (a key-entry
	 * screen, say) calls `activate()` directly and reads the CoolBeansError.
	 */
	private async claimSeat(licenseKey: string): Promise<string | null> {
		try {
			const { instance } = await this.activate(licenseKey);
			return instance.id;
		} catch {
			return null;
		}
	}

	/** The verdict from local state alone. Never makes a request. */
	private async offlineVerdict(): Promise<AccessState> {
		const revoked = this.storage.getItem(REVOKED_KEY) === '1';
		const nothingKnown = (): AccessState =>
			revoked
				? { decision: 'deny', reason: 'revoked', license: null }
				: { decision: 'deny', reason: 'uninitialized', license: null };

		const token = this.storage.getItem(TOKEN_KEY);
		if (!token) return nothingKnown();

		// Only signature-verified tokens count, and an unverifiable one is not evidence of a
		// revocation either — it is a token we know nothing about.
		const keys = this.trustedKeys();
		const payload = keys ? await verifyTokenSignature(token, keys) : null;
		if (!payload) return nothingKnown();
		if (this.product !== undefined && payload.product !== this.product) return nothingKnown();
		const boundInstance = this.storage.getItem(INSTANCE_KEY);
		if (boundInstance && payload.instance_id !== boundInstance) return nothingKnown();

		const license = licenseFromPayload(payload);
		if (payload.status === 'disabled') return { decision: 'deny', reason: 'revoked', license };

		const now = this.effectiveNow();
		// A signed expiry that has passed is our own credential saying the licence ended, so
		// honouring it is not inferring revocation from a network failure.
		if (payload.expires_at && new Date(payload.expires_at).getTime() <= now) {
			return { decision: 'deny', reason: 'expired', license };
		}
		const withinTtl = payload.exp * 1000 > now;
		// Trials get no grace: an unbounded one turns a blocked endpoint into a free licence.
		if (payload.kind === 'trial' && !withinTtl) {
			return { decision: 'deny', reason: 'expired', license };
		}
		const rolledBack = now > Date.now();
		return {
			decision: 'allow',
			reason: rolledBack ? 'clock_rollback' : withinTtl ? 'cached' : 'grace',
			license,
			expiresAt: license.expires_at,
			...(payload.entitlements ? { entitlements: payload.entitlements } : {}),
		};
	}

	/**
	 * Now, or the latest time this install has ever seen, whichever is later. Winding the
	 * clock back is the cheapest way to extend a licence, so expiry is judged against the
	 * floor. A successful validation resets it, so one bad clock is not a life sentence.
	 */
	private effectiveNow(): number {
		const floor = Number(this.storage.getItem(CLOCK_KEY));
		const now = Date.now();
		return Number.isFinite(floor) && floor > now ? floor : now;
	}

	/** Raise the clock floor to now. Called before any expiry is evaluated. */
	private rememberClock(): void {
		this.storage.setItem(CLOCK_KEY, String(this.effectiveNow()));
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
		// Only when the app declared a product; the signature is the real binding otherwise.
		if (this.product !== undefined && data.license.product !== this.product)
			return inconclusive(false);

		if (data.token) {
			this.storage.setItem(TOKEN_KEY, data.token);
			this.storage.setItem(INSTANCE_KEY, opts.instanceId);
			// Best effort while we are already online: fetch when there is no keyset or the
			// returned token uses a rotated/unknown key. offlineState itself never fetches.
			const keys = this.trustedKeys();
			if (!keys || !(await verifyTokenSignature(data.token, keys)))
				await this.refreshKeys(licenseKey);
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

	/**
	 * Accept a vendor-issued offline activation blob, for a machine that will never reach
	 * the server. Entirely local: no request is made, and none ever will be.
	 *
	 * The blob is only trusted if its signature verifies against a key this app already
	 * carries, so a forged or edited one is refused — it is handed around as text, which
	 * makes tampering the obvious attack. It must also name this product and still be
	 * within its lifetime, since importing an already-dead activation would leave the app
	 * silently locked.
	 *
	 * On success the device is bound to the instance the vendor took the seat for, and
	 * `offlineState()` behaves exactly as it would after a normal online activation.
	 */
	async importActivation(token: string): Promise<void> {
		const keys = this.trustedKeys();
		if (!keys) {
			throw new CoolBeansError(0, {
				error: 'no_trusted_keys',
				message: 'No public keys are available to verify this activation.',
			});
		}
		const payload = await verifyTokenSignature(token, keys);
		if (!payload) {
			throw new CoolBeansError(0, {
				error: 'invalid_activation',
				message: 'That activation could not be verified. Check it was pasted in full.',
			});
		}
		if (payload.product !== this.product) {
			throw new CoolBeansError(0, {
				error: 'product_mismatch',
				message: 'That activation is for a different product.',
			});
		}
		if (payload.exp * 1000 <= Date.now()) {
			throw new CoolBeansError(0, {
				error: 'activation_expired',
				message: 'That activation has expired. Ask for a fresh one.',
			});
		}
		// The binding check, and the whole reason a blob can be handed around as text.
		// Comparing against the token's own instance_id would be circular — we are about to
		// store that value ourselves — so the signed fingerprint is the only claim that says
		// anything about *this* machine.
		if (!payload.fingerprint) {
			throw new CoolBeansError(0, {
				error: 'unbound_activation',
				message: 'That activation is not bound to a machine. Ask for one issued for this device.',
			});
		}
		if (payload.fingerprint !== this.fingerprint()) {
			throw new CoolBeansError(0, {
				error: 'wrong_device',
				message: 'That activation was issued for a different machine.',
			});
		}
		// Bind the device before storing the token, so offlineState's instance check has
		// something to compare against rather than silently passing.
		this.storage.setItem(INSTANCE_KEY, payload.instance_id);
		this.storage.setItem(TOKEN_KEY, token);
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

		// Claim binding: the token must be for this device's instance, and for the product the
		// app declared IF it declared one. Without a declared product the signature does this
		// work: a token from elsewhere is signed by a different product's key and will not verify.
		if (this.product !== undefined && payload.product !== this.product) return 'expired';
		const boundInstance = this.storage.getItem(INSTANCE_KEY);
		if (boundInstance && payload.instance_id !== boundInstance) return 'expired';

		if (payload.status === 'disabled') return 'expired';

		// The same clock floor open() keeps, so the two surfaces cannot disagree about whether
		// a licence has ended. Absent any open() call the floor is unset and this is just now.
		const now = this.effectiveNow();

		// A signed expiry that has passed is definitive, whatever the kind. The token we
		// issued says this licence ended, so honouring it is reading our own credential,
		// not inferring revocation from a network failure — §8 is untouched, and it is what
		// makes subscription revocation reach someone who has gone offline.
		//
		// Perpetual licences carry no expires_at, so they are unaffected. The server decides
		// what date goes in here: pushing it out past the true expiry buys a dunning buffer
		// without the client needing a second grace concept.
		if (payload.expires_at && new Date(payload.expires_at).getTime() <= now) return 'expired';

		if (payload.kind === 'trial') {
			// Trials get no TTL grace either. An unbounded grace would turn a blocked
			// endpoint into an unlimited trial, which is the cheapest attack there is.
			return payload.exp * 1000 > now ? 'valid' : 'expired';
		}
		// Past the token TTL with a licence that has not expired: grace, never a lockout.
		return payload.exp * 1000 > now ? 'valid' : 'grace';
	}

	/**
	 * Renew a floating lease, keeping this device's seat held.
	 *
	 * Returns the new lease expiry, or null when nothing was renewed — an unknown or
	 * deactivated instance, a lapsed lease with no free seat to reclaim, or a node-locked
	 * product where leases do not apply. The caller needs that difference to tell "seat
	 * held" from "re-activate before continuing", so it is not flattened into a boolean.
	 */
	async heartbeat(licenseKey: string, opts: { instanceId: string }): Promise<string | null> {
		const res = await this.post('/v1/heartbeat', {
			license_key: licenseKey,
			instance_id: opts.instanceId,
		});
		if (!res.ok) throw new CoolBeansError(res.status, await res.json().catch(() => null));
		const data = (await res.json()) as { ok: boolean; lease_expires_at: string | null };
		return data.lease_expires_at ?? null;
	}

	/**
	 * Refresh at a third of the token's own lifetime, so there are two or three chances to
	 * reconnect before a user drifts into grace. Falls back to a day when no token has been
	 * cached yet.
	 */
	private defaultInterval(): number {
		const token = this.storage.getItem(TOKEN_KEY);
		if (token) {
			try {
				const body = token.split('.')[1] ?? '';
				const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))) as {
					iat?: number;
					exp?: number;
				};
				if (payload.exp && payload.iat && payload.exp > payload.iat) {
					return ((payload.exp - payload.iat) * 1000) / 3;
				}
			} catch {
				// Unreadable token: fall through to the default rather than guessing.
			}
		}
		return DEFAULT_INTERVAL_MS;
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

	/** The licence key inside the cached token, so key fetching needs no argument. */
	private cachedTokenKey(): string | undefined {
		// Decoded, not verified: this only decides which key to send to a route that will refuse
		// it if it is wrong. Nothing is unlocked on the strength of it.
		const key = this.cachedTokenPayload()?.key;
		return typeof key === 'string' ? key : undefined;
	}

	/** The cached token's claims, decoded without verifying. Never a basis for unlocking. */
	private cachedTokenPayload(): TokenPayload | undefined {
		const token = this.storage.getItem(TOKEN_KEY);
		return token ? decodeToken(token)?.payload : undefined;
	}

	/**
	 * Fetch the keyset and persist it. Returns true when new keys were stored.
	 *
	 * By licence key where we have one, which is what lets an app skip the product slug: the
	 * key is the credential so it goes in a POST body, never a URL that lands in access logs.
	 * Falls back to the slug route for an app that declared a product and has no key in hand.
	 */
	private async refreshKeys(licenseKey?: string): Promise<boolean> {
		const key = licenseKey ?? this.cachedTokenKey();
		try {
			const res = key
				? await this.post('/v1/keyset', { license_key: key })
				: this.product === undefined
					? null
					: await this.doFetch(
							`${this.baseUrl}/v1/pubkey?product=${encodeURIComponent(this.product)}`,
						);
			if (!res) return false;
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

/**
 * Prefer the server's own sentence, which is written for a human and names the real
 * problem. Falling back to "request failed" everywhere hid the reason — and for the local
 * checks in importActivation it was actively wrong, since no request was made at all.
 */
function errorMessage(status: number, body: unknown): string {
	const message = (body as { message?: unknown } | null | undefined)?.message;
	if (typeof message === 'string' && message.length > 0) return message;
	return status > 0 ? `Cool Beans request failed (${status})` : 'Cool Beans check failed';
}

export class CoolBeansError extends Error {
	constructor(
		readonly status: number,
		readonly body: unknown,
	) {
		super(errorMessage(status, body));
		this.name = 'CoolBeansError';
	}
}
