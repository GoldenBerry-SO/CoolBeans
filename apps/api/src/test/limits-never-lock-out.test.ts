// ABOUTME: Named for the PRD §8 sentence it defends — a plan limit must never lock a user out.
// ABOUTME: An account over every cap, and one downgraded from Pro, behaves identically on the frozen §9 path.

import { accounts, licenses, products, purchases } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { ensureLicense } from '../services/payments.js';
import { makeHarness } from './harness.js';
import { createProduct, issueKey, post } from './seed.js';

const cloud: Partial<Config> = {
	billing: { stripeSecretKey: 'sk_billing', proPriceId: 'price_pro' },
};

/**
 * A free account well past both caps: three products and several licences, against
 * limits of one and one. Built while on Pro, then downgraded, which is exactly what
 * happens when a customer's card lapses or they choose to leave.
 */
async function overEveryLimit() {
	const h = makeHarness({ config: cloud });
	h.deps.db.update(accounts).set({ plan: 'pro' }).where(eq(accounts.id, 1)).run();
	for (const slug of ['alpha', 'beta', 'gamma']) {
		await createProduct(h.app, {
			slug,
			name: slug,
			key_prefix: slug.toUpperCase(),
			email_from: 'r@c.io',
			activation_limit: 3,
		});
	}
	const key = await issueKey(h.app, {
		product: 'alpha',
		email: 'buyer@example.com',
		tier: 'yearly',
	});
	for (const email of ['a@c.io', 'b@c.io', 'c@c.io']) {
		await issueKey(h.app, { product: 'alpha', email, tier: 'lifetime' });
	}
	// The downgrade.
	h.deps.db
		.update(accounts)
		.set({ plan: 'free', productLimit: 1, activeLicenseLimit: 1 })
		.where(eq(accounts.id, 1))
		.run();
	return { ...h, key };
}

describe('an account over every plan limit', () => {
	it('activates a device exactly as an under-limit account does', async () => {
		const { app, key } = await overEveryLimit();
		const { status, body } = await post(app, '/v1/activate', {
			license_key: key,
			instance_name: 'laptop',
		});
		expect(status).toBe(200);
		expect((body.license as Record<string, unknown>).status).toBe('active');
	});

	it('validates', async () => {
		const { app, key } = await overEveryLimit();
		const activated = await post(app, '/v1/activate', {
			license_key: key,
			instance_name: 'laptop',
		});
		const instanceId = (activated.body.instance as Record<string, string>).id;
		const { status, body } = await post(app, '/v1/validate', {
			license_key: key,
			instance_id: instanceId,
		});
		expect(status).toBe(200);
		expect((body.license as Record<string, unknown>).status).toBe('active');
	});

	it('heartbeats and deactivates', async () => {
		const { app, key } = await overEveryLimit();
		const activated = await post(app, '/v1/activate', {
			license_key: key,
			instance_name: 'laptop',
		});
		const instanceId = (activated.body.instance as Record<string, string>).id;
		expect(
			(await post(app, '/v1/heartbeat', { license_key: key, instance_id: instanceId })).status,
		).toBe(200);
		expect(
			(await post(app, '/v1/deactivate', { license_key: key, instance_id: instanceId })).status,
		).toBe(200);
	});

	it('still uses every activation seat the product allows', async () => {
		// The plan cap counts licences, not seats. Bleeding into the seat limit would be a
		// lockout dressed up as a billing rule.
		const { app, key } = await overEveryLimit();
		for (let i = 0; i < 3; i += 1) {
			expect(
				(await post(app, '/v1/activate', { license_key: key, instance_name: `dev-${i}` })).status,
			).toBe(200);
		}
	});

	it('answers /v1/usage', async () => {
		const { app, key } = await overEveryLimit();
		const activated = await post(app, '/v1/activate', {
			license_key: key,
			instance_name: 'laptop',
		});
		const instanceId = (activated.body.instance as Record<string, string>).id;
		const res = await app.request('/v1/usage', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ license_key: key, instance_id: instanceId, metric: 'exports' }),
		});
		// Whatever this answers, it must not be a plan-limit refusal.
		expect(res.status).not.toBe(409);
		expect(await res.text()).not.toContain('plan');
	});
});

describe('downgrading from Pro to Free', () => {
	it('revokes, archives and disables nothing', async () => {
		const h = await overEveryLimit();
		const allProducts = h.deps.db.select().from(products).all();
		expect(allProducts).toHaveLength(3);
		expect(allProducts.every((p) => p.archivedAt === null)).toBe(true);
		const allLicences = h.deps.db.select().from(licenses).all();
		expect(allLicences).toHaveLength(4);
		expect(allLicences.every((l) => l.status === 'active')).toBe(true);
	});

	it('blocks only new creation', async () => {
		const h = await overEveryLimit();
		const created = await h.app.request('/admin/products', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				slug: 'delta',
				name: 'Delta',
				key_prefix: 'DELTA',
				email_from: 'r@c.io',
			}),
		});
		expect(created.status).toBe(409);
	});

	it('keeps honouring a paid checkout for an over-limit account', async () => {
		// The customer is over their plan, but their buyer's money is real.
		const h = await overEveryLimit();
		const product = h.deps.db.select().from(products).where(eq(products.slug, 'beta')).get();
		if (!product) throw new Error('seed failed');
		const result = await ensureLicense(h.deps, {
			product,
			provider: 'stripe',
			checkoutId: 'cs_over_limit',
			tier: 'lifetime',
			email: 'newbuyer@example.com',
		});
		expect(result.created).toBe(true);

		const purchase = h.deps.db
			.select()
			.from(purchases)
			.where(eq(purchases.providerCheckoutId, 'cs_over_limit'))
			.get();
		expect(purchase).toBeDefined();
	});
});
