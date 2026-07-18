// ABOUTME: The licensing core (PRD §9) — activate/validate/deactivate/heartbeat with atomic seats.
// ABOUTME: Seat limits and floating leases are enforced in single guarded statements, never read-then-write.

import { randomUUID } from 'node:crypto';
import type { Activation, License, Product } from '@coolbeans/db';
import { activations, licenses } from '@coolbeans/db';
import { and, eq, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { looksLikeKey, normalizeAgainst, toDisplayKey } from '../domain/keygen.js';
import {
	ApiError,
	activationLimitReached,
	invalidKey,
	licenseDisabled,
	unknownKey,
} from '../http/errors.js';
import { writeAudit } from '../store/audit.js';
import { getProductById, listPrefixes } from '../store/products.js';
import { assertKeyNotThrottled, clearKeyFailures, recordKeyFailure } from './key-throttle.js';
import { mintToken } from './signing.js';

export interface ResolvedLicense {
	license: License;
	product: Product;
	/** Effective status accounting for lazy trial expiry. */
	status: 'active' | 'disabled';
}

/**
 * Normalize a key against known prefixes and load its license + product.
 * Throws invalid_key (422) if the format fails, unknown_key (404) if not found.
 * Lazily disables an expired trial and records the reason.
 */
/**
 * Resolve with the per-key brute-force throttle applied (issue #39). Public endpoints
 * use this; internal callers that already hold a license row do not need it.
 */
export function resolveLicenseThrottled(deps: AppDeps, keyInput: string): ResolvedLicense {
	assertKeyNotThrottled(deps, keyInput);
	try {
		const resolved = resolveLicense(deps, keyInput);
		clearKeyFailures(deps, keyInput);
		return resolved;
	} catch (err) {
		// Only a failed *lookup* counts: a disabled key is a definitive answer, not a probe.
		if (err instanceof ApiError && (err.code === 'unknown_key' || err.code === 'invalid_key')) {
			recordKeyFailure(deps, keyInput);
		}
		throw err;
	}
}

export function resolveLicense(deps: AppDeps, keyInput: string): ResolvedLicense {
	const { db } = deps;
	// Format check before any storage hit (§10, §19): malformed input never reaches the DB.
	if (!looksLikeKey(keyInput)) throw invalidKey();
	const parsed = normalizeAgainst(keyInput, listPrefixes(db));
	if (!parsed) throw invalidKey();
	const license = db.select().from(licenses).where(eq(licenses.key, parsed.normalized)).get();
	if (!license) throw unknownKey();
	const product = getProductById(db, license.productId);
	if (!product) throw unknownKey();

	let status = license.status;
	if (status === 'active' && isTrialExpired(license, nowDate(deps))) {
		// Persist the lazy expiry so the trail and downstream reads agree.
		const disabledAt = nowDate(deps).toISOString();
		db.update(licenses)
			.set({ status: 'disabled', disabledAt, disabledReason: 'trial_expired' })
			.where(eq(licenses.id, license.id))
			.run();
		license.status = 'disabled';
		license.disabledAt = disabledAt;
		license.disabledReason = 'trial_expired';
		status = 'disabled';
		writeAudit(db, {
			action: 'license.disabled',
			actor: 'system',
			productId: product.id,
			licenseId: license.id,
			detail: { reason: 'trial_expired' },
		});
	}

	return { license, product, status };
}

function isTrialExpired(license: License, now: Date): boolean {
	if (license.tier !== 'trial' || !license.expiresAt) return false;
	return new Date(license.expiresAt).getTime() <= now.getTime();
}

/** The SQL fragment that counts a live seat, honoring floating-lease expiry. */
function liveSeatCondition(product: Product, nowIso: string) {
	if (product.activationModel === 'floating') {
		return sql`deactivated_at IS NULL AND lease_expires_at > ${nowIso}`;
	}
	return sql`deactivated_at IS NULL`;
}

export interface ActivateResult {
	license: License;
	product: Product;
	activation: Activation;
	displayKey: string;
}

/** POST /v1/activate — enforce the seat limit atomically; reuse a device by name (PRD §9). */
export function activate(deps: AppDeps, keyInput: string, instanceName: string): ActivateResult {
	const { db } = deps;
	const resolved = resolveLicenseThrottled(deps, keyInput);
	if (resolved.status === 'disabled') throw licenseDisabled();
	const { license, product } = resolved;
	const now = nowDate(deps);
	const nowIso = now.toISOString();
	const leaseExpiresAt =
		product.activationModel === 'floating'
			? new Date(now.getTime() + product.floatingLeaseMinutes * 60_000).toISOString()
			: null;

	const activation = db.transaction((tx): Activation => {
		// Reuse an existing live seat for the same device name rather than burning a seat.
		if (instanceName) {
			const existing = tx
				.select()
				.from(activations)
				.where(
					and(
						eq(activations.licenseId, license.id),
						eq(activations.name, instanceName),
						sql`deactivated_at IS NULL`,
					),
				)
				.get();
			if (existing) {
				if (leaseExpiresAt) {
					// Guarded renew: an expired lease may only be revived if a seat is free —
					// other live leases (excluding this record) must be under the limit.
					const renewed = tx.run(sql`
						UPDATE activations SET lease_expires_at = ${leaseExpiresAt}
						WHERE id = ${existing.id}
						AND (
							SELECT COUNT(*) FROM activations
							WHERE license_id = ${license.id} AND id != ${existing.id}
								AND ${liveSeatCondition(product, nowIso)}
						) < ${product.activationLimit}
					`);
					if (renewed.changes === 0) throw activationLimitReached(product.activationLimit);
					existing.leaseExpiresAt = leaseExpiresAt;
				}
				return existing;
			}
		}

		// Guarded insert: only succeeds if live seats are below the limit (single atomic statement).
		const instanceId = randomUUID();
		const result = tx.run(sql`
			INSERT INTO activations (instance_id, license_id, name, created_at, lease_expires_at)
			SELECT ${instanceId}, ${license.id}, ${instanceName}, ${nowIso}, ${leaseExpiresAt}
			WHERE (
				SELECT COUNT(*) FROM activations
				WHERE license_id = ${license.id} AND ${liveSeatCondition(product, nowIso)}
			) < ${product.activationLimit}
		`);
		if (result.changes === 0) throw activationLimitReached(product.activationLimit);
		const created = tx
			.select()
			.from(activations)
			.where(eq(activations.instanceId, instanceId))
			.get();
		if (!created) throw activationLimitReached(product.activationLimit);
		return created;
	});

	writeAudit(db, {
		action: 'activation.created',
		actor: 'client',
		productId: product.id,
		licenseId: license.id,
		detail: { instance_id: activation.instanceId, name: instanceName },
	});

	return { license, product, activation, displayKey: toDisplayKey(license.key, product.keyPrefix) };
}

export interface ValidateResult {
	valid: boolean;
	license: License;
	product: Product;
	status: 'active' | 'disabled';
	activation: Activation | null;
	token: string | null;
}

/** POST /v1/validate — a known key always returns 200; token only on a live instance (PRD §9). */
export function validate(deps: AppDeps, keyInput: string, instanceId: string): ValidateResult {
	const { db } = deps;
	const resolved = resolveLicense(deps, keyInput);
	const { license, product, status } = resolved;

	if (status === 'disabled') {
		return { valid: false, license, product, status, activation: null, token: null };
	}

	const activation = db
		.select()
		.from(activations)
		.where(and(eq(activations.instanceId, instanceId), eq(activations.licenseId, license.id)))
		.get();

	const now = nowDate(deps);
	const live =
		activation &&
		!activation.deactivatedAt &&
		(product.activationModel !== 'floating' ||
			(activation.leaseExpiresAt !== null &&
				new Date(activation.leaseExpiresAt).getTime() > now.getTime()));

	if (!activation || !live) {
		return { valid: false, license, product, status, activation: null, token: null };
	}

	const nowIso = now.toISOString();
	db.update(activations)
		.set({ lastValidatedAt: nowIso })
		.where(eq(activations.id, activation.id))
		.run();

	const token = mintToken(deps, {
		license,
		product,
		instanceId,
		displayKey: toDisplayKey(license.key, product.keyPrefix),
	});

	return { valid: true, license, product, status, activation, token };
}

/** POST /v1/deactivate — idempotent seat free (PRD §9). */
export function deactivate(deps: AppDeps, keyInput: string, instanceId: string): void {
	const { db } = deps;
	const resolved = resolveLicense(deps, keyInput);
	const nowIso = nowDate(deps).toISOString();
	const result = db
		.update(activations)
		.set({ deactivatedAt: nowIso })
		.where(
			and(
				eq(activations.instanceId, instanceId),
				eq(activations.licenseId, resolved.license.id),
				sql`deactivated_at IS NULL`,
			),
		)
		.run();
	if (result.changes > 0) {
		writeAudit(db, {
			action: 'activation.deactivated',
			actor: 'client',
			productId: resolved.product.id,
			licenseId: resolved.license.id,
			detail: { instance_id: instanceId },
		});
	}
}

export interface HeartbeatResult {
	leaseExpiresAt: string | null;
}

/** POST /v1/heartbeat — renew a floating lease, keeping the seat held (PRD §9). */
export function heartbeat(deps: AppDeps, keyInput: string, instanceId: string): HeartbeatResult {
	const { db } = deps;
	const resolved = resolveLicense(deps, keyInput);
	if (resolved.status === 'disabled') throw licenseDisabled();
	const { license, product } = resolved;

	if (product.activationModel !== 'floating') {
		return { leaseExpiresAt: null };
	}

	const now = nowDate(deps);
	const nowIso = now.toISOString();
	const leaseExpiresAt = new Date(
		now.getTime() + product.floatingLeaseMinutes * 60_000,
	).toISOString();
	// Renew a live lease freely; an expired lease may only be revived if a seat is free
	// (other live leases stay under the limit). A crashed client whose seat was taken
	// must re-activate rather than silently exceeding the pool.
	const renewed = db.run(sql`
		UPDATE activations SET lease_expires_at = ${leaseExpiresAt}
		WHERE instance_id = ${instanceId} AND license_id = ${license.id}
			AND deactivated_at IS NULL
			AND (
				lease_expires_at > ${nowIso}
				OR (
					SELECT COUNT(*) FROM activations AS others
					WHERE others.license_id = ${license.id}
						AND others.instance_id != ${instanceId}
						AND others.deactivated_at IS NULL
						AND others.lease_expires_at > ${nowIso}
				) < ${product.activationLimit}
			)
	`);
	// No row renewed: unknown/deactivated instance, or a lapsed lease with no free seat.
	return { leaseExpiresAt: renewed.changes > 0 ? leaseExpiresAt : null };
}
