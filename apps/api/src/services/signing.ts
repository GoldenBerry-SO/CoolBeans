// ABOUTME: Signing-key management (PRD §11) — per-product Ed25519 keypairs, private half encrypted.
// ABOUTME: Mints offline tokens with the active key; serves all keys for verification (rotation-safe).

import type { License, Product, SigningKey } from '@coolbeans/db';
import { signingKeys } from '@coolbeans/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { decryptSecret, encryptSecret } from '../domain/crypto.js';
import { generateSigningKeyPair, signToken, type TokenPayload } from '../domain/token.js';

/** The active signing key for a product (falling back to the global key), creating one if absent. */
export function getOrCreateActiveKey(deps: AppDeps, productId: number | null): SigningKey {
	const { db } = deps;
	const scope =
		productId === null ? isNull(signingKeys.productId) : eq(signingKeys.productId, productId);
	const existing = db
		.select()
		.from(signingKeys)
		.where(and(scope, eq(signingKeys.active, true)))
		.get();
	if (existing) return existing;

	const pair = generateSigningKeyPair();
	const inserted = db
		.insert(signingKeys)
		.values({
			productId,
			publicKey: pair.publicKey,
			privateKey: encryptSecret(pair.privateKey, deps.config.signingKeySecret),
			active: true,
		})
		.returning()
		.get();
	return inserted;
}

/** All signing keys for a product (active + retired) keyed by kid — for verification/rotation. */
export function publicKeysFor(deps: AppDeps, productId: number | null): Record<string, string> {
	const { db } = deps;
	const scope =
		productId === null ? isNull(signingKeys.productId) : eq(signingKeys.productId, productId);
	const rows = db.select().from(signingKeys).where(scope).all();
	const out: Record<string, string> = {};
	for (const row of rows) out[String(row.id)] = row.publicKey;
	return out;
}

/** Rotate: retire the current active key and create a fresh active one. Returns the new key. */
export function rotateKey(deps: AppDeps, productId: number | null): SigningKey {
	const { db } = deps;
	const scope =
		productId === null ? isNull(signingKeys.productId) : eq(signingKeys.productId, productId);
	db.update(signingKeys)
		.set({ active: false })
		.where(and(scope, eq(signingKeys.active, true)))
		.run();
	const pair = generateSigningKeyPair();
	return db
		.insert(signingKeys)
		.values({
			productId,
			publicKey: pair.publicKey,
			privateKey: encryptSecret(pair.privateKey, deps.config.signingKeySecret),
			active: true,
		})
		.returning()
		.get();
}

/** Mint a signed offline token for a validated license+instance (PRD §11). */
export function mintToken(
	deps: AppDeps,
	args: { license: License; product: Product; instanceId: string; displayKey: string },
): string {
	const key = getOrCreateActiveKey(deps, args.product.id);
	const privateKey = decryptSecret(key.privateKey, deps.config.signingKeySecret);
	const iat = Math.floor(nowDate(deps).getTime() / 1000);
	let exp = iat + deps.config.tokenTtlDays * 86_400;
	// Trial expiry is enforced (§9): the offline token must not outlive the trial itself,
	// or verifyOffline would keep unlocking after the trial ends.
	if (args.license.tier === 'trial' && args.license.expiresAt) {
		exp = Math.min(exp, Math.floor(new Date(args.license.expiresAt).getTime() / 1000));
	}
	const payload: TokenPayload = {
		key: args.displayKey,
		status: 'active',
		tier: args.license.tier,
		product: args.product.slug,
		expires_at: args.license.expiresAt ?? null,
		instance_id: args.instanceId,
		iat,
		exp,
	};
	return signToken(payload, { publicKey: key.publicKey, privateKey }, String(key.id));
}
