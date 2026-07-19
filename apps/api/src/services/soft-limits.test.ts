// ABOUTME: Webhook issuance past the licence cap must still deliver the key, and say so loudly.
// ABOUTME: Refusing here would break a customer's business to collect an upgrade fee from them.

import { accounts, licenses, products } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { makeHarness } from '../test/harness.js';
import { ensureLicense } from './payments.js';

const cloud: Partial<Config> = {
	billing: { stripeSecretKey: 'sk_billing', proPriceId: 'price_pro' },
};

/** A free account, capped at one active licence, that already holds one. */
async function accountAtCap() {
	const h = makeHarness({ config: cloud });
	h.deps.db
		.update(accounts)
		.set({ plan: 'free', activeLicenseLimit: 1 })
		.where(eq(accounts.id, 1))
		.run();
	const product = h.deps.db
		.insert(products)
		.values({ slug: 'alpha', name: 'Alpha', keyPrefix: 'ALPHA', emailFrom: 'r@c.io' })
		.returning()
		.get();
	await ensureLicense(h.deps, {
		product,
		provider: 'stripe',
		checkoutId: 'cs_first',
		tier: 'lifetime',
		email: 'first@buyer.io',
	});
	return { ...h, product };
}

describe('webhook issuance past the licence cap', () => {
	it('still issues the key', async () => {
		const { deps, product } = await accountAtCap();
		const result = await ensureLicense(deps, {
			product,
			provider: 'stripe',
			checkoutId: 'cs_second',
			tier: 'lifetime',
			email: 'second@buyer.io',
		});
		// The buyer paid our customer. Withholding this key would break their business.
		expect(result.created).toBe(true);
		expect(deps.db.select().from(licenses).all()).toHaveLength(2);
	});

	it('logs an error an operator will notice', async () => {
		const { deps, logger, product } = await accountAtCap();
		await ensureLicense(deps, {
			product,
			provider: 'stripe',
			checkoutId: 'cs_second',
			tier: 'lifetime',
			email: 'second@buyer.io',
		});
		const line = logger.lines.find((l) => l.message.includes('past the plan limit'));
		expect(line?.level).toBe('error');
		expect(line?.fields).toMatchObject({ current: 1, limit: 1 });
	});

	it('audits the overage against the account', async () => {
		const { deps, product } = await accountAtCap();
		await ensureLicense(deps, {
			product,
			provider: 'stripe',
			checkoutId: 'cs_second',
			tier: 'lifetime',
			email: 'second@buyer.io',
		});
		const row = deps.db.$client
			.prepare(
				"SELECT account_id, detail FROM audit_log WHERE action = 'account.license_limit_exceeded'",
			)
			.get() as { account_id: number; detail: string } | undefined;
		expect(row?.account_id).toBe(1);
		expect(JSON.parse(row?.detail ?? '{}')).toMatchObject({ current: 1, limit: 1 });
	});

	it('stamps over_limit_since once and keeps the first date', async () => {
		const { deps, product, clock } = await accountAtCap();
		await ensureLicense(deps, {
			product,
			provider: 'stripe',
			checkoutId: 'cs_second',
			tier: 'lifetime',
			email: 'second@buyer.io',
		});
		const first = (
			deps.db.$client.prepare('SELECT over_limit_since FROM accounts WHERE id = 1').get() as {
				over_limit_since: string;
			}
		).over_limit_since;
		expect(first).toBeTruthy();

		clock.advance(86_400_000);
		await ensureLicense(deps, {
			product,
			provider: 'stripe',
			checkoutId: 'cs_third',
			tier: 'lifetime',
			email: 'third@buyer.io',
		});
		const after = (
			deps.db.$client.prepare('SELECT over_limit_since FROM accounts WHERE id = 1').get() as {
				over_limit_since: string;
			}
		).over_limit_since;
		// The banner should say when they first went over, not when they last did.
		expect(after).toBe(first);
	});

	it('says nothing on a self-host instance, which has no limits at all', async () => {
		const h = makeHarness();
		h.deps.db
			.update(accounts)
			.set({ plan: 'free', activeLicenseLimit: 1 })
			.where(eq(accounts.id, 1))
			.run();
		const product = h.deps.db
			.insert(products)
			.values({ slug: 'alpha', name: 'Alpha', keyPrefix: 'ALPHA', emailFrom: 'r@c.io' })
			.returning()
			.get();
		for (const id of ['cs_1', 'cs_2', 'cs_3']) {
			await ensureLicense(h.deps, {
				product,
				provider: 'stripe',
				checkoutId: id,
				tier: 'lifetime',
				email: `${id}@buyer.io`,
			});
		}
		expect(h.logger.lines.some((l) => l.message.includes('past the plan limit'))).toBe(false);
		const row = h.deps.db.$client
			.prepare('SELECT over_limit_since FROM accounts WHERE id = 1')
			.get() as { over_limit_since: string | null };
		expect(row.over_limit_since).toBeNull();
	});
});
