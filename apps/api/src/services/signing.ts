// ABOUTME: Signing-key management (PRD §11) — per-product Ed25519 keypairs, private half encrypted.
// ABOUTME: Mints offline tokens with the active key; serves all keys for verification (rotation-safe).

import type { License, Product, SigningKey } from '@coolbeans/db';
import { signingKeys } from '@coolbeans/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { decryptSecret, encryptSecret } from '../domain/crypto.js';
import { generateSigningKeyPair, signToken, type TokenPayload } from '../domain/token.js';

/**
 * The active signing key for a product, or the global (product_id NULL) key when the
 * product has none — §11 allows an operator to run one keypair for every product.
 * Only mints a per-product key when neither exists.
 */
export async function getOrCreateActiveKey(
	deps: AppDeps,
	productId: number | null,
): Promise<SigningKey> {
	const { db } = deps;
	const scope =
		productId === null ? isNull(signingKeys.productId) : eq(signingKeys.productId, productId);
	const [existing] = await db
		.select()
		.from(signingKeys)
		.where(and(scope, eq(signingKeys.active, true)))
		.limit(1);
	if (existing) return existing;

	if (productId !== null) {
		const [global] = await db
			.select()
			.from(signingKeys)
			.where(and(isNull(signingKeys.productId), eq(signingKeys.active, true)))
			.limit(1);
		if (global) return global;
	}

	const pair = generateSigningKeyPair();
	const [inserted] = await db
		.insert(signingKeys)
		.values({
			productId,
			publicKey: pair.publicKey,
			privateKey: encryptSecret(pair.privateKey, deps.config.signingKeySecret),
			active: true,
		})
		.returning();
	return inserted;
}

/**
 * All signing keys a client may need to verify this product's tokens, keyed by kid:
 * the product's own keys (active + retired) plus the global keys, since a token may
 * have been signed by either. Retired keys stay so rotation never breaks verification.
 */
export async function publicKeysFor(
	deps: AppDeps,
	productId: number | null,
): Promise<Record<string, string>> {
	const { db } = deps;
	const rows =
		productId === null
			? await db.select().from(signingKeys).where(isNull(signingKeys.productId))
			: await db
					.select()
					.from(signingKeys)
					.where(or(eq(signingKeys.productId, productId), isNull(signingKeys.productId)));
	const out: Record<string, string> = {};
	for (const row of rows) out[String(row.id)] = row.publicKey;
	return out;
}

/**
 * Boot check: prove SIGNING_KEY_SECRET actually decrypts what is stored. Without this
 * a wrong or rotated secret is only discovered when a client asks for a token, which
 * looks like a licensing outage rather than a misconfiguration.
 */
export async function assertSigningKeysUsable(deps: {
	db: AppDeps['db'];
	config: { signingKeySecret: string };
}): Promise<void> {
	const rows = await deps.db.select().from(signingKeys).where(eq(signingKeys.active, true));
	for (const row of rows) {
		try {
			decryptSecret(row.privateKey, deps.config.signingKeySecret);
		} catch {
			throw new Error(
				`SIGNING_KEY_SECRET cannot decrypt signing key ${row.id}. It does not match the secret these keys were created with; restoring the original secret is the only way to keep issued offline tokens verifiable.`,
			);
		}
	}
}

/** Rotate: retire the current active key and create a fresh active one. Returns the new key. */
export async function rotateKey(deps: AppDeps, productId: number | null): Promise<SigningKey> {
	const { db } = deps;
	const scope =
		productId === null ? isNull(signingKeys.productId) : eq(signingKeys.productId, productId);
	await db
		.update(signingKeys)
		.set({ active: false })
		.where(and(scope, eq(signingKeys.active, true)));
	const pair = generateSigningKeyPair();
	const [created] = await db
		.insert(signingKeys)
		.values({
			productId,
			publicKey: pair.publicKey,
			privateKey: encryptSecret(pair.privateKey, deps.config.signingKeySecret),
			active: true,
		})
		.returning();
	return created;
}

/**
 * The `expires_at` claim to put in a token: the licence expiry plus a buffer.
 *
 * The SDK treats a past `expires_at` as definitive and ends access offline, which is what
 * makes subscription revocation reach a machine that has gone dark. The cost is that a
 * subscriber who renews while offline still holds a token carrying the OLD expiry, and
 * would be locked out on a licence they have paid for. The buffer is the room they need to
 * reconnect, and it lives here rather than in the client so it can be tuned without
 * shipping an app update.
 *
 * Never applied to a trial — a buffered trial is simply a longer trial, and §9 says the
 * token must not outlive it. Never applied to a null expiry, which would invent an end
 * date for a lifetime licence that has none.
 */
function bufferedExpiry(deps: AppDeps, license: License): string | null {
	if (!license.expiresAt) return null;
	if (license.kind === 'trial') return license.expiresAt;
	const buffered =
		new Date(license.expiresAt).getTime() + deps.config.offlineTokenBufferDays * 86_400_000;
	return new Date(buffered).toISOString();
}

/**
 * Mint a signed offline token for a validated license+instance (PRD §11).
 *
 * Returns the payload alongside the token because the caller cannot otherwise tell when
 * the thing it just handed out stops working: `exp` is the TTL clamped by the licence,
 * and the licence's own expiry is not the same value — a lifetime licence has none, and
 * its token still dies at the TTL.
 */
export async function mintToken(
	deps: AppDeps,
	args: {
		license: License;
		product: Product;
		instanceId: string;
		displayKey: string;
		/**
		 * Set only for a vendor-mediated activation of a machine that will never reach us.
		 *
		 * One object rather than two optional fields, because the long TTL, the missing
		 * buffer and the device binding are a single decision and are only ever safe
		 * together. Split apart, a caller could ask for the year-long TTL and forget the
		 * fingerprint, which is an unbound token good for a year on any machine it is
		 * pasted into — the exact hole this binding was added to close.
		 */
		offline?: { fingerprint: string; ttlDays: number };
	},
): Promise<{ token: string; payload: TokenPayload }> {
	const key = await getOrCreateActiveKey(deps, args.product.id);
	const privateKey = decryptSecret(key.privateKey, deps.config.signingKeySecret);
	const iat = Math.floor(nowDate(deps).getTime() / 1000);
	let exp = iat + (args.offline?.ttlDays ?? deps.config.tokenTtlDays) * 86_400;
	// Trial expiry is enforced (§9): the offline token must not outlive the trial itself,
	// or verifyOffline would keep unlocking after the trial ends.
	if (args.license.kind === 'trial' && args.license.expiresAt) {
		exp = Math.min(exp, Math.floor(new Date(args.license.expiresAt).getTime() / 1000));
	}
	// The renewal buffer exists so a client that CAN reconnect has room to. An air-gapped
	// machine never will, so buffering it only lets an unreachable machine outlive the
	// licence it was paid for.
	const claimedExpiry = args.offline
		? (args.license.expiresAt ?? null)
		: bufferedExpiry(deps, args.license);
	// A token must never outlive the expiry it carries. Harmless for a normal 7-day token,
	// load-bearing for a year-long offline activation on a licence that ends sooner —
	// there is no way to reach that machine and correct it later.
	if (claimedExpiry) {
		exp = Math.min(exp, Math.floor(new Date(claimedExpiry).getTime() / 1000));
	}
	const payload: TokenPayload = {
		key: args.displayKey,
		status: 'active',
		kind: args.license.kind,
		plan: args.license.plan ?? null,
		product: args.product.slug,
		expires_at: claimedExpiry,
		// Omitted rather than nulled when there are none: absent means "no capability map",
		// which is a different thing from an empty one.
		...(args.license.entitlements ? { entitlements: args.license.entitlements } : {}),
		...(args.offline ? { fingerprint: args.offline.fingerprint } : {}),
		instance_id: args.instanceId,
		iat,
		exp,
	};
	return {
		token: signToken(payload, { publicKey: key.publicKey, privateKey }, String(key.id)),
		payload,
	};
}
