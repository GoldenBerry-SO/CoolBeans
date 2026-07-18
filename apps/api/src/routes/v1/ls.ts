// ABOUTME: Lemon Squeezy parity alias routes (PRD §9) — POST /v1/licenses/activate|validate|deactivate.
// ABOUTME: Emulates the LS License API response shape exactly so a base-URL swap migrates clients.

import type { License, Product } from '@coolbeans/db';
import { activations } from '@coolbeans/db';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AppDeps } from '../../deps.js';
import { nowDate } from '../../deps.js';
import { toDisplayKey } from '../../domain/keygen.js';
import { ApiError } from '../../http/errors.js';
import { activate, deactivate, resolveLicense, validate } from '../../services/licensing.js';

/** LS-shaped license_key object. status maps active | expired (trial) | disabled. */
function lsLicenseKey(deps: AppDeps, license: License, product: Product) {
	const nowIso = nowDate(deps).toISOString();
	const leaseCondition =
		product.activationModel === 'floating'
			? sql`${activations.leaseExpiresAt} > ${nowIso}`
			: sql`1 = 1`;
	const liveSeats = deps.db
		.select({ n: sql<number>`count(*)` })
		.from(activations)
		.where(
			and(eq(activations.licenseId, license.id), isNull(activations.deactivatedAt), leaseCondition),
		)
		.get();
	let status: string = license.status;
	if (license.status === 'disabled') {
		status = license.disabledReason === 'trial_expired' ? 'expired' : 'disabled';
	}
	return {
		id: license.id,
		status,
		key: toDisplayKey(license.key, product.keyPrefix),
		activation_limit: product.activationLimit,
		activation_usage: liveSeats?.n ?? 0,
		created_at: license.createdAt,
		expires_at: license.expiresAt ?? null,
	};
}

function lsMeta(product: Product, email: string | null) {
	return {
		store_id: null,
		product_id: product.id,
		product_name: product.name,
		customer_name: null,
		customer_email: email,
	};
}

/** Accept LS-style JSON or form-encoded bodies. */
async function readParams(c: {
	req: {
		header: (n: string) => string | undefined;
		json: () => Promise<unknown>;
		parseBody: () => Promise<Record<string, unknown>>;
	};
}): Promise<Record<string, string>> {
	const ct = c.req.header('content-type') ?? '';
	if (ct.includes('application/json')) {
		const body = (await c.req.json()) as Record<string, unknown>;
		return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v ?? '')]));
	}
	const body = await c.req.parseBody();
	return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v ?? '')]));
}

/**
 * The LS license/meta objects for a key we actually know, or undefined when the key
 * is unknown or malformed — those stay null-shaped so we leak nothing about them.
 */
function knownLicenseShape(deps: AppDeps, keyInput: string) {
	try {
		const resolved = resolveLicense(deps, keyInput);
		return {
			licenseKey: lsLicenseKey(deps, resolved.license, resolved.product),
			meta: lsMeta(resolved.product, null),
		};
	} catch {
		return undefined;
	}
}

function errorShape(err: unknown, base: Record<string, unknown>) {
	const message = err instanceof ApiError ? err.message : 'Request failed.';
	// LS returns 400 for most license errors; keep 404 for unknown key.
	const status = err instanceof ApiError && err.status === 404 ? 404 : 400;
	return { status, body: { ...base, error: message } };
}

export function registerLemonSqueezyRoutes(app: OpenAPIHono, deps: AppDeps): void {
	app.post('/v1/licenses/activate', async (c) => {
		const params = await readParams(c);
		try {
			const result = activate(deps, params.license_key ?? '', params.instance_name ?? '');
			return c.json({
				activated: true,
				error: null,
				license_key: lsLicenseKey(deps, result.license, result.product),
				instance: {
					id: result.activation.instanceId,
					name: result.activation.name,
					created_at: result.activation.createdAt,
				},
				meta: lsMeta(result.product, null),
			});
		} catch (err) {
			// LS still returns the license object when it refuses a known key, and a
			// migrating client reads status off it — so carry it whenever we can.
			const known = knownLicenseShape(deps, params.license_key ?? '');
			const { status, body } = errorShape(err, {
				activated: false,
				license_key: known?.licenseKey ?? null,
				instance: null,
				meta: known?.meta ?? null,
			});
			return c.json(body, status as never);
		}
	});

	app.post('/v1/licenses/validate', async (c) => {
		const params = await readParams(c);
		try {
			// LS semantics: without an instance_id, validate the key alone (instance: null).
			if (!params.instance_id) {
				const resolved = resolveLicense(deps, params.license_key ?? '');
				const valid = resolved.status === 'active';
				return c.json({
					valid,
					error: valid ? null : 'This license key has been disabled.',
					license_key: lsLicenseKey(deps, resolved.license, resolved.product),
					instance: null,
					meta: lsMeta(resolved.product, null),
				});
			}
			const result = validate(deps, params.license_key ?? '', params.instance_id);
			return c.json({
				valid: result.valid,
				error: result.valid ? null : 'License is not valid for this instance.',
				license_key: lsLicenseKey(deps, result.license, result.product),
				instance: result.activation
					? {
							id: result.activation.instanceId,
							name: result.activation.name,
							created_at: result.activation.createdAt,
						}
					: null,
				meta: lsMeta(result.product, null),
			});
		} catch (err) {
			const { status, body } = errorShape(err, {
				valid: false,
				license_key: null,
				instance: null,
				meta: null,
			});
			return c.json(body, status as never);
		}
	});

	app.post('/v1/licenses/deactivate', async (c) => {
		const params = await readParams(c);
		try {
			const resolved = resolveLicense(deps, params.license_key ?? '');
			deactivate(deps, params.license_key ?? '', params.instance_id ?? '');
			return c.json({
				deactivated: true,
				error: null,
				license_key: lsLicenseKey(deps, resolved.license, resolved.product),
				meta: lsMeta(resolved.product, null),
			});
		} catch (err) {
			const { status, body } = errorShape(err, {
				deactivated: false,
				license_key: null,
				meta: null,
			});
			return c.json(body, status as never);
		}
	});
}
