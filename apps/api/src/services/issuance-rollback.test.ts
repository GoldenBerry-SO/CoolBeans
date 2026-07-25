// ABOUTME: Proves purchase + licence + outbox row commit together or not at all (withTx).
// ABOUTME: An orphaned purchase permanently blocks the provider retry via the checkout-id UNIQUE.

import { licenses, products, purchases } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness } from '../test/harness.js';
import { enqueue } from './outbox.js';
import { ensureLicense } from './payments.js';

vi.mock('./outbox.js', { spy: true });

afterEach(() => {
	vi.restoreAllMocks();
});

describe('issuance is atomic', () => {
	it('a failure after the purchase write leaves no orphaned purchase behind', async () => {
		// The trap this guards: createPurchase, issueLicense and the outbox enqueue run in
		// one transaction, but the helpers take a deps bundle. If any of them is handed the
		// OUTER deps instead of the transaction-bound one, its write survives the rollback.
		// purchases.provider_checkout_id is UNIQUE, so a surviving purchase makes every
		// provider retry of this checkout hit a dead row: the customer has paid, has no key,
		// and no retry can ever succeed without manual surgery. On the single-connection
		// test driver the same mistake is a deadlock instead — either way, this test fails.
		const h = await makeHarness();
		const [product] = await h.deps.db
			.insert(products)
			.values({ slug: 'clementine', name: 'Clementine', keyPrefix: 'CLEM', emailFrom: 'r@c.io' })
			.returning();

		vi.mocked(enqueue).mockRejectedValueOnce(new Error('outbox unavailable'));

		await expect(
			ensureLicense(h.deps, {
				product,
				provider: 'stripe',
				checkoutId: 'cs_rollback_1',
				email: 'buyer@example.com',
				kind: 'perpetual',
			}),
		).rejects.toThrow('outbox unavailable');

		// Nothing survived the rollback: no purchase, no licence.
		expect(
			await h.deps.db
				.select()
				.from(purchases)
				.where(eq(purchases.providerCheckoutId, 'cs_rollback_1')),
		).toHaveLength(0);
		expect(await h.deps.db.select().from(licenses)).toHaveLength(0);

		// And because nothing survived, the provider's retry re-enters cleanly and issues.
		const retried = await ensureLicense(h.deps, {
			product,
			provider: 'stripe',
			checkoutId: 'cs_rollback_1',
			email: 'buyer@example.com',
			kind: 'perpetual',
		});
		expect(retried.created).toBe(true);
		expect(retried.license.status).toBe('active');
	});
});
