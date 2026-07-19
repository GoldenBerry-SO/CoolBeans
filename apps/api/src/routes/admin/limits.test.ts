// ABOUTME: Plan limit enforcement — hard refusal where an admin is at a keyboard, soft where money moved.
// ABOUTME: Also proves archiving frees a product slot and that concurrent creates cannot both win.

import { accounts, products } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../config.js';
import { makeHarness } from '../../test/harness.js';
import { createProduct } from '../../test/seed.js';

const cloud: Partial<Config> = {
	billing: { stripeSecretKey: 'sk_billing', proPriceId: 'price_pro' },
};

/** A cloud harness whose single account is on the free plan. */
function freeAccount(overrides: Partial<Config> = {}) {
	const h = makeHarness({ config: { ...cloud, ...overrides } });
	h.deps.db.update(accounts).set({ plan: 'free' }).where(eq(accounts.id, 1)).run();
	return h;
}

function productBody(slug: string) {
	return {
		slug,
		name: slug,
		key_prefix: slug
			.slice(0, 6)
			.toUpperCase()
			.replace(/[^A-Z]/g, 'X'),
		email_from: 'r@c.io',
	};
}

async function postProduct(h: ReturnType<typeof makeHarness>, slug: string) {
	return h.app.request('/admin/products', {
		method: 'POST',
		headers: h.adminHeaders,
		body: JSON.stringify(productBody(slug)),
	});
}

describe('product limit', () => {
	it('allows the first product on Free and refuses the second', async () => {
		const h = freeAccount();
		expect((await postProduct(h, 'alpha')).status).toBe(200);
		const second = await postProduct(h, 'beta');
		expect(second.status).toBe(409);
		expect((await second.json()) as { error: string }).toMatchObject({
			error: 'product_limit_reached',
		});
	});

	it('allows any number on Pro', async () => {
		const h = makeHarness({ config: cloud });
		h.deps.db.update(accounts).set({ plan: 'pro' }).where(eq(accounts.id, 1)).run();
		expect((await postProduct(h, 'alpha')).status).toBe(200);
		expect((await postProduct(h, 'beta')).status).toBe(200);
	});

	it('never limits a self-host instance', async () => {
		// No billing configured. PRD §7 says self-host is unlimited, full stop.
		const h = makeHarness();
		h.deps.db.update(accounts).set({ plan: 'free' }).where(eq(accounts.id, 1)).run();
		expect((await postProduct(h, 'alpha')).status).toBe(200);
		expect((await postProduct(h, 'beta')).status).toBe(200);
	});

	it('frees the slot when a product is archived', async () => {
		const h = freeAccount();
		await postProduct(h, 'alpha');
		expect((await postProduct(h, 'beta')).status).toBe(409);
		await h.app.request('/admin/products/alpha', { method: 'DELETE', headers: h.adminHeaders });
		// Archiving is the recoverable way down from the cap: nothing is deleted, and §9
		// keeps the archived product's issued keys validating.
		expect((await postProduct(h, 'beta')).status).toBe(200);
	});

	it('respects a per-account override', async () => {
		const h = freeAccount();
		h.deps.db.update(accounts).set({ productLimit: 2 }).where(eq(accounts.id, 1)).run();
		expect((await postProduct(h, 'alpha')).status).toBe(200);
		expect((await postProduct(h, 'beta')).status).toBe(200);
		expect((await postProduct(h, 'gamma')).status).toBe(409);
	});

	it('admits exactly one of several overlapping creates at the cap', async () => {
		// Honest about what this proves: better-sqlite3 is synchronous, so these requests
		// cannot actually interleave inside the insert, and a read-then-write version of
		// the same handler passes this test too (verified by mutation). What it pins is
		// that five attempts against a cap of one yield one product and four refusals.
		//
		// The atomicity itself lives in the statement shape — the count is a subquery
		// inside the INSERT, matching the seat cap in services/licensing.ts — and is
		// exercised for real, with a negative control, in scripts/postgres/atomicity.mjs.
		const h = freeAccount();
		const results = await Promise.all(
			['a', 'b', 'c', 'd', 'e'].map((slug) => postProduct(h, `prod-${slug}`)),
		);
		expect(results.filter((r) => r.status === 200)).toHaveLength(1);
		expect(results.filter((r) => r.status === 409)).toHaveLength(4);
		expect(h.deps.db.select().from(products).all()).toHaveLength(1);
	});
});

describe('manual key limit', () => {
	/** A free account holding `count` active licences, with the cap set just above/at it. */
	async function accountAtLicenceCap(limit: number) {
		const h = freeAccount();
		h.deps.db.update(accounts).set({ activeLicenseLimit: limit }).where(eq(accounts.id, 1)).run();
		await createProduct(h.app, productBody('alpha'), h.adminHeaders);
		return h;
	}

	async function issue(h: ReturnType<typeof makeHarness>, email: string) {
		return h.app.request('/admin/keys', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({ product: 'alpha', email, tier: 'lifetime' }),
		});
	}

	it('refuses a manual key once the account is at the cap', async () => {
		// An admin is at a keyboard and no money has moved, so refusing is honest.
		const h = await accountAtLicenceCap(2);
		expect((await issue(h, 'one@c.io')).status).toBe(200);
		expect((await issue(h, 'two@c.io')).status).toBe(200);
		const third = await issue(h, 'three@c.io');
		expect(third.status).toBe(409);
		expect((await third.json()) as { error: string }).toMatchObject({
			error: 'license_limit_reached',
		});
	});

	it('counts only active licences, so disabling one frees room', async () => {
		const h = await accountAtLicenceCap(1);
		const first = await issue(h, 'one@c.io');
		const { key } = (await first.json()) as { key: string };
		expect((await issue(h, 'two@c.io')).status).toBe(409);
		await h.app.request(`/admin/keys/${key}/disable`, {
			method: 'POST',
			headers: h.adminHeaders,
		});
		expect((await issue(h, 'two@c.io')).status).toBe(200);
	});

	it('never limits a self-host instance', async () => {
		const h = makeHarness();
		h.deps.db
			.update(accounts)
			.set({ plan: 'free', activeLicenseLimit: 1 })
			.where(eq(accounts.id, 1))
			.run();
		await createProduct(h.app, productBody('alpha'), h.adminHeaders);
		expect((await issue(h, 'one@c.io')).status).toBe(200);
		expect((await issue(h, 'two@c.io')).status).toBe(200);
	});
});
