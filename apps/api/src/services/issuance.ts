// ABOUTME: The shared issuance core (PRD §13, §14) — one idempotent path from purchase to key.
// ABOUTME: Every payment provider and manual admin issue funnels through here; keys are collision-safe.

import type { License, NewPurchase, Product } from '@coolbeans/db';
import { licenses, purchases } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { generateKey, normalizedKey, parseKey } from '../domain/keygen.js';
import { writeAudit } from '../store/audit.js';

const MAX_KEY_RETRIES = 3;

export type Tier = 'lifetime' | 'yearly' | 'trial';

/** Insert a license with a freshly generated, unique key. Retries on the rare collision. */
export function issueLicense(
	deps: AppDeps,
	args: {
		product: Product;
		purchaseId: number;
		tier: Tier;
		expiresAt?: string | null;
		actor: string;
	},
): License {
	const { db } = deps;
	for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt++) {
		const display = generateKey(args.product.keyPrefix);
		const parsed = parseKey(display, args.product.keyPrefix);
		const normalized = parsed?.normalized ?? normalizedKey(args.product.keyPrefix, display);
		const existing = db
			.select({ id: licenses.id })
			.from(licenses)
			.where(eq(licenses.key, normalized))
			.get();
		if (existing) continue;
		const license = db
			.insert(licenses)
			.values({
				productId: args.product.id,
				purchaseId: args.purchaseId,
				key: normalized,
				tier: args.tier,
				status: 'active',
				expiresAt: args.expiresAt ?? null,
			})
			.returning()
			.get();
		writeAudit(db, {
			action: 'license.issued',
			actor: args.actor,
			productId: args.product.id,
			licenseId: license.id,
			detail: { tier: args.tier, key: display },
		});
		return license;
	}
	throw new Error('Failed to generate a unique license key after retries');
}

/** Create a purchase row. provider_checkout_id UNIQUE anchors idempotency for webhooks. */
export function createPurchase(deps: AppDeps, values: NewPurchase) {
	return deps.db.insert(purchases).values(values).returning().get();
}

/** Trial expiry helper: now + days, ISO 8601. */
export function trialExpiry(deps: AppDeps, days: number): string {
	return new Date(nowDate(deps).getTime() + days * 86_400_000).toISOString();
}

/** Manual issue for the admin API/CLI — a purchase (provider=manual) plus a license. */
export function issueManual(
	deps: AppDeps,
	args: {
		product: Product;
		email: string;
		tier: Tier;
		expiresAt?: string | null;
		note?: string;
		actor: string;
	},
): License {
	const purchase = createPurchase(deps, {
		productId: args.product.id,
		provider: 'manual',
		email: args.email,
		note: args.note ?? null,
	});
	return issueLicense(deps, {
		product: args.product,
		purchaseId: purchase.id,
		tier: args.tier,
		expiresAt: args.expiresAt,
		actor: args.actor,
	});
}
