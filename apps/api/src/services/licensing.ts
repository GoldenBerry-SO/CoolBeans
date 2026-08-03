// ABOUTME: The licensing core (PRD §9) — activate/validate/deactivate/heartbeat with atomic seats.
// ABOUTME: Seat limits and floating leases are enforced in single guarded statements, never read-then-write.

import { randomUUID } from 'node:crypto';
import type { Activation, License, Product } from '@coolbeans/db';
import { activations, applied, licenses } from '@coolbeans/db';
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
import { writeAuditBestEffort } from '../store/audit.js';
import { getProductById, listPrefixes } from '../store/products.js';
import { assertKeyNotThrottled, clearKeyFailures, recordKeyFailure } from './key-throttle.js';
import { mintToken } from './signing.js';
import { recordValidation } from './validation-stats.js';

/**
 * Seats this licence gets: its own snapshot if it has one, otherwise the product's limit.
 *
 * A grant can price seats (Basic 3, Pro 10 on one product), and issuance snapshots that onto the
 * licence so re-pricing later never changes what somebody already bought. Both values are read
 * from rows the caller already holds, so the guarded seat statements stay single-statement atomic.
 */
export function seatLimit(license: Pick<License, 'activationLimit'>, product: Product): number {
	return license.activationLimit ?? product.activationLimit;
}

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
 * Resolve a raw key from a public request, with the per-key brute-force throttle
 * applied (issue #39). Every public path funnels through here — activate, validate,
 * deactivate, heartbeat, usage, portal and the LS aliases — so the limit cannot be
 * sidestepped by probing a different endpoint.
 */
export async function resolveLicense(deps: AppDeps, keyInput: string): Promise<ResolvedLicense> {
	assertKeyNotThrottled(deps, keyInput);
	try {
		const resolved = await resolveLicenseUnthrottled(deps, keyInput);
		clearKeyFailures(keyInput);
		return resolved;
	} catch (err) {
		// Only a failed *lookup* counts: a disabled key is a definitive answer, not a probe.
		if (err instanceof ApiError && (err.code === 'unknown_key' || err.code === 'invalid_key')) {
			recordKeyFailure(deps, keyInput);
		}
		throw err;
	}
}

/** The raw lookup, without throttling — for callers that already passed through it. */
export async function resolveLicenseUnthrottled(
	deps: AppDeps,
	keyInput: string,
): Promise<ResolvedLicense> {
	const { db } = deps;
	// Format check before any storage hit (§10, §19): malformed input never reaches the DB.
	if (!looksLikeKey(keyInput)) throw invalidKey();
	const parsed = normalizeAgainst(keyInput, await listPrefixes(db));
	if (!parsed) throw invalidKey();
	const [license] = await db
		.select()
		.from(licenses)
		.where(eq(licenses.key, parsed.normalized))
		.limit(1);
	if (!license) throw unknownKey();
	const product = await getProductById(db, license.productId);
	if (!product) throw unknownKey();

	let status = license.status;
	if (status === 'active' && isTrialExpired(license, nowDate(deps))) {
		// Persist the lazy expiry so the trail and downstream reads agree.
		const disabledAt = nowDate(deps).toISOString();
		await db
			.update(licenses)
			.set({ status: 'disabled', disabledAt, disabledReason: 'trial_expired' })
			.where(eq(licenses.id, license.id));
		license.status = 'disabled';
		license.disabledAt = disabledAt;
		license.disabledReason = 'trial_expired';
		status = 'disabled';
		await writeAuditBestEffort(db, deps.logger, {
			action: 'license.disabled',
			actor: 'system',
			accountId: product.accountId,
			productId: product.id,
			licenseId: license.id,
			detail: { reason: 'trial_expired' },
		});
	}

	return { license, product, status };
}

function isTrialExpired(license: License, now: Date): boolean {
	if (license.kind !== 'trial' || !license.expiresAt) return false;
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
export async function activate(
	deps: AppDeps,
	keyInput: string,
	instanceName: string,
): Promise<ActivateResult> {
	const { db } = deps;
	const resolved = await resolveLicense(deps, keyInput);
	if (resolved.status === 'disabled') throw licenseDisabled();
	const { license, product } = resolved;
	const now = nowDate(deps);
	const nowIso = now.toISOString();
	const leaseExpiresAt =
		product.activationModel === 'floating'
			? new Date(now.getTime() + product.floatingLeaseMinutes * 60_000).toISOString()
			: null;

	const activation = await db.transaction(async (tx): Promise<Activation> => {
		// Serialise every contender for THIS licence before anything reads seat state.
		// Under MVCC each concurrent transaction otherwise counts seats against its own
		// snapshot, all see "under the limit", and all insert — atomicity.mjs measured a
		// 3-seat cap admitting 12. The lock is per-licence, so contention is confined to
		// the one licence being hammered; and it must precede the reuse-by-name SELECT
		// below, because that read participates in the same decision.
		await tx.execute(sql`SELECT id FROM licenses WHERE id = ${license.id} FOR UPDATE`);
		// Reuse an existing live seat for the same device name rather than burning a seat.
		if (instanceName) {
			const [existing] = await tx
				.select()
				.from(activations)
				.where(
					and(
						eq(activations.licenseId, license.id),
						eq(activations.name, instanceName),
						sql`deactivated_at IS NULL`,
					),
				)
				.limit(1);
			if (existing) {
				if (leaseExpiresAt) {
					// Guarded renew: an expired lease may only be revived if a seat is free —
					// other live leases (excluding this record) must be under the limit.
					const renewed = await tx.execute(sql`
						UPDATE activations SET lease_expires_at = ${leaseExpiresAt}
						WHERE id = ${existing.id}
						AND (
							SELECT COUNT(*) FROM activations
							WHERE license_id = ${license.id} AND id != ${existing.id}
								AND ${liveSeatCondition(product, nowIso)}
						) < ${seatLimit(license, product)}
						RETURNING id
					`);
					if (!applied(renewed)) throw activationLimitReached(seatLimit(license, product));
					existing.leaseExpiresAt = leaseExpiresAt;
				}
				return existing;
			}
		}

		// Guarded insert: only succeeds if live seats are below the limit (single atomic statement).
		const instanceId = randomUUID();
		const result = await tx.execute(sql`
			INSERT INTO activations (instance_id, license_id, name, created_at, lease_expires_at)
			SELECT ${instanceId}, ${license.id}, ${instanceName}, ${nowIso}, ${leaseExpiresAt}
			WHERE (
				SELECT COUNT(*) FROM activations
				WHERE license_id = ${license.id} AND ${liveSeatCondition(product, nowIso)}
			) < ${seatLimit(license, product)}
			RETURNING id
		`);
		if (!applied(result)) throw activationLimitReached(seatLimit(license, product));
		const [created] = await tx
			.select()
			.from(activations)
			.where(eq(activations.instanceId, instanceId))
			.limit(1);
		if (!created) throw activationLimitReached(seatLimit(license, product));
		return created;
	});

	await writeAuditBestEffort(db, deps.logger, {
		action: 'activation.created',
		actor: 'client',
		accountId: product.accountId,
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
export async function validate(
	deps: AppDeps,
	keyInput: string,
	instanceId: string,
): Promise<ValidateResult> {
	const { db } = deps;
	const resolved = await resolveLicense(deps, keyInput);
	const { license, product, status } = resolved;

	// Count every check that reached a real licence, refusals included: the chart is
	// usage, and lapsed keys still phoning home are exactly what an operator wants to
	// see — which is why the outcome rides along (#101).
	const record = (refused: boolean) =>
		recordValidation(deps, { productId: product.id, licenseId: license.id, refused });

	if (status === 'disabled') {
		await record(true);
		return { valid: false, license, product, status, activation: null, token: null };
	}

	const [activation] = await db
		.select()
		.from(activations)
		.where(and(eq(activations.instanceId, instanceId), eq(activations.licenseId, license.id)))
		.limit(1);

	const now = nowDate(deps);
	const live =
		activation &&
		!activation.deactivatedAt &&
		(product.activationModel !== 'floating' ||
			(activation.leaseExpiresAt !== null &&
				new Date(activation.leaseExpiresAt).getTime() > now.getTime()));

	if (!activation || !live) {
		await record(true);
		return { valid: false, license, product, status, activation: null, token: null };
	}

	const nowIso = now.toISOString();
	await db
		.update(activations)
		.set({ lastValidatedAt: nowIso })
		.where(eq(activations.id, activation.id));

	const { token } = await mintToken(deps, {
		license,
		product,
		instanceId,
		displayKey: toDisplayKey(license.key, product.keyPrefix),
	});

	await record(false);
	return { valid: true, license, product, status, activation, token };
}

/** POST /v1/deactivate — idempotent seat free (PRD §9). */
export async function deactivate(
	deps: AppDeps,
	keyInput: string,
	instanceId: string,
): Promise<void> {
	const { db } = deps;
	const resolved = await resolveLicense(deps, keyInput);
	const nowIso = nowDate(deps).toISOString();
	const result = await db
		.update(activations)
		.set({ deactivatedAt: nowIso })
		.where(
			and(
				eq(activations.instanceId, instanceId),
				eq(activations.licenseId, resolved.license.id),
				sql`deactivated_at IS NULL`,
			),
		)
		.returning({ id: activations.id });
	if (applied(result)) {
		await writeAuditBestEffort(db, deps.logger, {
			action: 'activation.deactivated',
			actor: 'client',
			accountId: resolved.product.accountId,
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
export async function heartbeat(
	deps: AppDeps,
	keyInput: string,
	instanceId: string,
): Promise<HeartbeatResult> {
	const { db } = deps;
	const resolved = await resolveLicense(deps, keyInput);
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
	// Two statements on purpose. Extending a lease that is still live cannot change the
	// live count, so the hot path — every healthy client, every few minutes — takes no
	// lock at all. Only reviving a LAPSED lease takes a seat, and only that path queues
	// on the licence row; wrapping the whole thing in one locked statement would put a
	// row lock on the highest-frequency write in the system for nothing.
	const extended = await db.execute(sql`
		UPDATE activations SET lease_expires_at = ${leaseExpiresAt}
		WHERE instance_id = ${instanceId} AND license_id = ${license.id}
			AND deactivated_at IS NULL AND lease_expires_at > ${nowIso}
		RETURNING id
	`);
	if (applied(extended)) return { leaseExpiresAt };

	// Revival: a crashed client whose seat lapsed may come back only if a seat is free,
	// under the same licence lock the seat cap takes — otherwise N lapsed clients racing
	// one free seat all count the others as expired and all revive (the unlocked form
	// admits every contender; the race suite pins this).
	return await db.transaction(async (tx) => {
		await tx.execute(sql`SELECT id FROM licenses WHERE id = ${license.id} FOR UPDATE`);
		const revived = await tx.execute(sql`
			UPDATE activations SET lease_expires_at = ${leaseExpiresAt}
			WHERE instance_id = ${instanceId} AND license_id = ${license.id}
				AND deactivated_at IS NULL
				AND (
					SELECT COUNT(*) FROM activations AS others
					WHERE others.license_id = ${license.id}
						AND others.instance_id != ${instanceId}
						AND others.deactivated_at IS NULL
						AND others.lease_expires_at > ${nowIso}
				) < ${seatLimit(license, product)}
			RETURNING id
		`);
		// No row: unknown/deactivated instance, or a lapsed lease with no free seat.
		return { leaseExpiresAt: applied(revived) ? leaseExpiresAt : null };
	});
}
