// ABOUTME: The key-collision retry inside an enclosing transaction — the savepoint that saves it.
// ABOUTME: Without it, attempt two hits 25P02 and a customer whose payment cleared gets no key.

import { licenses, products, purchases } from '@coolbeans/db';
import { describe, expect, it, vi } from 'vitest';
import * as keygen from '../domain/keygen.js';
import { makeHarness } from '../test/harness.js';
import { issueManual } from './issuance.js';

describe('issuance under a key collision', () => {
	it('retries past a collision inside the enclosing transaction', async () => {
		const h = await makeHarness();
		const [product] = await h.deps.db
			.insert(products)
			.values({ slug: 'clementine', name: 'Clementine', keyPrefix: 'CLEM', emailFrom: 'r@c.io' })
			.returning();

		// First issuance takes some key K.
		const first = await issueManual(h.deps, {
			product,
			email: 'first@example.com',
			kind: 'perpetual',
			actor: 'test',
		});

		// Force the next generate to collide with K once, then behave normally. The insert
		// runs inside issueManual's transaction, so on Postgres the unique violation aborts
		// everything up the stack unless each attempt is savepointed — this test is red
		// against the unsavepointed form with "current transaction is aborted".
		const spy = vi
			.spyOn(keygen, 'generateKey')
			.mockImplementationOnce(() => keygen.toDisplayKey(first.key, 'CLEM'));
		try {
			const second = await issueManual(h.deps, {
				product,
				email: 'second@example.com',
				kind: 'perpetual',
				actor: 'test',
			});
			expect(second.key).not.toBe(first.key);
			expect(spy).toHaveBeenCalled();

			// Both purchases and both licences exist: nothing up the stack was aborted.
			expect(await h.deps.db.select().from(licenses)).toHaveLength(2);
			expect(await h.deps.db.select().from(purchases)).toHaveLength(2);
		} finally {
			spy.mockRestore();
		}
	});
});
