// ABOUTME: The shared issuance core (PRD §13, §14) — one idempotent path from purchase to key.
// ABOUTME: Every payment provider and manual admin issue funnels through here; keys are collision-safe.

import type { License, NewPurchase, Product } from '@coolbeans/db';
import { licenses, purchases } from '@coolbeans/db';
import type { AppDeps } from '../deps.js';
import { nowDate, withTx } from '../deps.js';
import { generateKey, normalizedKey, parseKey } from '../domain/keygen.js';
import { writeAudit } from '../store/audit.js';
import { isUniqueConstraintError } from '../store/db-errors.js';

const MAX_KEY_RETRIES = 3;

export type Tier = 'lifetime' | 'yearly' | 'trial';

/** Insert a license with a freshly generated, unique key. Retries on the rare collision. */
export async function issueLicense(
	deps: AppDeps,
	args: {
		product: Product;
		purchaseId: number;
		tier: Tier;
		expiresAt?: string | null;
		actor: string;
	},
): Promise<License> {
	const { db } = deps;
	for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt++) {
		const display = generateKey(args.product.keyPrefix);
		const parsed = parseKey(display, args.product.keyPrefix);
		const normalized = parsed?.normalized ?? normalizedKey(args.product.keyPrefix, display);
		let license: License;
		try {
			const [inserted] = await db
				.insert(licenses)
				.values({
					productId: args.product.id,
					purchaseId: args.purchaseId,
					key: normalized,
					tier: args.tier,
					status: 'active',
					expiresAt: args.tier === 'lifetime' ? null : (args.expiresAt ?? null),
				})
				.returning();
			license = inserted;
		} catch (err) {
			// §10: regenerate on the rare collision — including one that races us to the
			// UNIQUE constraint between generate and insert.
			if (isUniqueConstraintError(err, ['licenses.key', 'licenses_key_unique', 'licenses (key)']))
				continue;
			throw err;
		}
		await writeAudit(db, {
			action: 'license.issued',
			actor: args.actor,
			productId: args.product.id,
			licenseId: license.id,
			// The key is the credential (§19): the audit trail records only its tail.
			detail: { tier: args.tier, key_suffix: display.slice(-4) },
		});
		return license;
	}
	throw new Error('Failed to generate a unique license key after retries');
}

/** Create a purchase row. provider_checkout_id UNIQUE anchors idempotency for webhooks. */
export async function createPurchase(deps: AppDeps, values: NewPurchase) {
	const [purchase] = await deps.db.insert(purchases).values(values).returning();
	return purchase;
}

/** Trial expiry helper: now + days, ISO 8601. */
export function trialExpiry(deps: AppDeps, days: number): string {
	return new Date(nowDate(deps).getTime() + days * 86_400_000).toISOString();
}

/**
 * A year from now, for a manually issued yearly licence.
 *
 * A yearly key with no expiry never lapses: only trials are swept, and validate only
 * expires trials lazily, so it behaves as a lifetime key. A subscription supplies its own
 * period end; a manual issue has no subscription, so it needs a default rather than null.
 * Calendar arithmetic, not 365 days, so a leap year does not shift the date.
 */
export function yearlyExpiry(deps: AppDeps): string {
	const now = nowDate(deps);
	const next = new Date(now.getTime());
	next.setUTCFullYear(now.getUTCFullYear() + 1);
	return next.toISOString();
}

/** Manual issue for the admin API/CLI — a purchase (provider=manual) plus a license. */
export async function issueManual(
	deps: AppDeps,
	args: {
		product: Product;
		email: string;
		tier: Tier;
		expiresAt?: string | null;
		note?: string;
		actor: string;
	},
): Promise<License> {
	return await deps.db.transaction(async (tx) => {
		// Same contract as ensureLicense: purchase and licence commit together or not at all.
		const scoped = withTx(deps, tx);
		const purchase = await createPurchase(scoped, {
			productId: args.product.id,
			provider: 'manual',
			email: args.email,
			note: args.note ?? null,
		});
		return await issueLicense(scoped, {
			product: args.product,
			purchaseId: purchase.id,
			tier: args.tier,
			expiresAt: args.expiresAt,
			actor: args.actor,
		});
	});
}
