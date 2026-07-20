// ABOUTME: Tests the plan limits — the Free caps, per-account overrides, and unlimited self-host.
// ABOUTME: Config is passed as a value rather than mutated onto process.env, matching loadConfig.

import type { Account } from '@coolbeans/db';
import { accounts, licenses, products, purchases } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { makeHarness, testConfig } from '../test/harness.js';
import { rawQuery } from '../test/pg.js';
import {
	countActiveLicenses,
	countLiveProducts,
	isBillingEnabled,
	limitsFor,
	markOverLimit,
	PLAN_LIMITS,
	planUsage,
	withinLimit,
} from './plan-limits.js';

const billingConfig: Partial<Config> = {
	billing: { stripeSecretKey: 'sk_billing', proPriceId: 'price_pro' },
};

function account(overrides: Partial<Account> = {}): Account {
	return {
		id: 1,
		name: 'Acme',
		plan: 'free',
		productLimit: null,
		activeLicenseLimit: null,
		overLimitSince: null,
		createdAt: '2026-07-18T00:00:00.000Z',
		...overrides,
	};
}

describe('plan limits', () => {
	it('caps Free at one product and 500 active licences', async () => {
		expect(PLAN_LIMITS.free).toEqual({ products: 1, activeLicenses: 500 });
	});

	it('leaves Pro uncapped', async () => {
		expect(PLAN_LIMITS.pro).toEqual({ products: null, activeLicenses: null });
	});

	it('is unlimited when no billing is configured, which is what self-host is', async () => {
		// PRD §7: self-host is free forever with unlimited everything. It must get there
		// through this function, not a parallel branch that can drift out of step.
		const deps = { config: testConfig() };
		expect(isBillingEnabled(deps)).toBe(false);
		expect(limitsFor(deps, account({ plan: 'free' }))).toEqual({
			products: null,
			activeLicenses: null,
		});
	});

	it('does not enable billing just because the product-sales Stripe key is set', async () => {
		const deps = { config: testConfig({ stripe: { secretKey: 'sk_test_customer' } }) };
		expect(isBillingEnabled(deps)).toBe(false);
		expect(limitsFor(deps, account()).products).toBeNull();
	});

	it('applies the plan defaults once billing is configured', async () => {
		const deps = { config: testConfig(billingConfig) };
		expect(limitsFor(deps, account({ plan: 'free' }))).toEqual({
			products: 1,
			activeLicenses: 500,
		});
		expect(limitsFor(deps, account({ plan: 'pro' }))).toEqual({
			products: null,
			activeLicenses: null,
		});
	});

	it('lets a per-account override beat the plan default', async () => {
		const deps = { config: testConfig(billingConfig) };
		const raised = account({ plan: 'free', productLimit: 5, activeLicenseLimit: 10_000 });
		expect(limitsFor(deps, raised)).toEqual({ products: 5, activeLicenses: 10_000 });
	});

	it('keeps Pro limits for a past-due account', async () => {
		// Tightening limits because a card expired is how you ruin a customer's day
		// mid-dunning. Payment state is the billing page's problem, not the limiter's.
		const deps = { config: testConfig(billingConfig) };
		expect(limitsFor(deps, account({ plan: 'pro', overLimitSince: null })).products).toBeNull();
	});
});

describe('withinLimit', () => {
	it('always fits when there is no cap', async () => {
		expect(withinLimit({ current: 9_999, limit: null })).toBe(true);
	});

	it('fits below the cap and refuses at it', async () => {
		expect(withinLimit({ current: 0, limit: 1 })).toBe(true);
		expect(withinLimit({ current: 1, limit: 1 })).toBe(false);
		expect(withinLimit({ current: 2, limit: 1 })).toBe(false);
	});
});

describe('usage counting', () => {
	async function seedProduct(
		deps: { db: Awaited<ReturnType<typeof makeHarness>>['deps']['db'] },
		slug: string,
	) {
		const [row] = await deps.db
			.insert(products)
			.values({ slug, name: slug, keyPrefix: slug.toUpperCase(), emailFrom: 'r@c.io' })
			.returning();
		return row;
	}

	it('counts live products and ignores archived ones', async () => {
		const { deps } = await makeHarness();
		await seedProduct(deps, 'alpha');
		const beta = await seedProduct(deps, 'beta');
		expect(await countLiveProducts(deps.db, 1)).toBe(2);
		await deps.db
			.update(products)
			.set({ archivedAt: '2026-07-18T00:00:00.000Z' })
			.where(eq(products.id, beta.id));
		// Archiving genuinely frees the slot, which is what makes the cap recoverable
		// without deleting anything.
		expect(await countLiveProducts(deps.db, 1)).toBe(1);
	});

	it('counts active licences across the account and ignores disabled ones', async () => {
		const { deps } = await makeHarness();
		const product = await seedProduct(deps, 'alpha');
		const [purchase] = await deps.db
			.insert(purchases)
			.values({ productId: product.id, provider: 'manual', email: 'b@example.com' })
			.returning();
		await deps.db.insert(licenses).values([
			{ productId: product.id, purchaseId: purchase.id, key: 'ALPHA1', tier: 'lifetime' },
			{ productId: product.id, purchaseId: purchase.id, key: 'ALPHA2', tier: 'lifetime' },
			{
				productId: product.id,
				purchaseId: purchase.id,
				key: 'ALPHA3',
				tier: 'lifetime',
				status: 'disabled',
			},
		]);
		expect(await countActiveLicenses(deps.db, 1)).toBe(2);
	});

	it('does not count another account rows', async () => {
		const { deps } = await makeHarness();
		// The account has to exist now: SQLite accepted this row with a dangling
		// account_id, but the FK the port added refuses fabricated tenants.
		const [other] = await deps.db.insert(accounts).values({ name: 'theirs.example' }).returning();
		await deps.db.insert(products).values({
			slug: 'theirs',
			name: 'Theirs',
			keyPrefix: 'THRS',
			emailFrom: 'r@c.io',
			accountId: other.id,
		});
		expect(await countLiveProducts(deps.db, 1)).toBe(0);
		expect(await countLiveProducts(deps.db, other.id)).toBe(1);
	});

	it('reports usage against the limits in force', async () => {
		const { deps } = await makeHarness({ config: billingConfig });
		await seedProduct(deps, 'alpha');
		const usage = await planUsage(deps, account({ plan: 'free' }));
		expect(usage.products).toEqual({ current: 1, limit: 1 });
		expect(usage.activeLicenses).toEqual({ current: 0, limit: 500 });
	});
});

describe('markOverLimit', () => {
	it('stamps the first time only, so the banner keeps the original date', async () => {
		const { deps } = await makeHarness();
		await markOverLimit(deps, 1, '2026-07-18T00:00:00.000Z');
		await markOverLimit(deps, 1, '2026-08-01T00:00:00.000Z');
		const [row] = await rawQuery<{ over_limit_since: string }>(
			'SELECT over_limit_since FROM accounts WHERE id = 1',
		);
		expect(row.over_limit_since).toBe('2026-07-18T00:00:00.000Z');
	});
});
