// ABOUTME: Tests the account store and the boot check that substitutes for the missing foreign keys.
// ABOUTME: The orphan check is the only thing standing between a bad backfill and a cross-tenant read.

import { products } from '@coolbeans/db';
import { describe, expect, it } from 'vitest';
import { makeHarness } from '../test/harness.js';
import {
	assertAccountsResolve,
	countAccounts,
	createAccount,
	DEFAULT_ACCOUNT_ID,
	getAccountById,
	getAccountByName,
} from './accounts.js';

describe('account store', () => {
	it('a migrated database starts with exactly one account', () => {
		const { deps } = makeHarness();
		expect(countAccounts(deps.db)).toBe(1);
		expect(getAccountById(deps.db, DEFAULT_ACCOUNT_ID)?.plan).toBe('pro');
	});

	it('creates accounts on the free plan', () => {
		const { deps } = makeHarness();
		const account = createAccount(deps.db, 'acme.com');
		// Never 'pro': gifting Pro later is easy, taking it back is not.
		expect(account.plan).toBe('free');
		expect(getAccountByName(deps.db, 'acme.com')?.id).toBe(account.id);
	});

	it('passes the boot check on a healthy database', () => {
		const { deps } = makeHarness();
		deps.db
			.insert(products)
			.values({ slug: 'clementine', name: 'Clementine', keyPrefix: 'CLEM', emailFrom: 'r@c.io' })
			.run();
		expect(() => assertAccountsResolve(deps.db)).not.toThrow();
	});

	it('catches a product pointing at an account that does not exist', () => {
		const { deps } = makeHarness();
		deps.db
			.insert(products)
			.values({
				slug: 'clementine',
				name: 'Clementine',
				keyPrefix: 'CLEM',
				emailFrom: 'r@c.io',
				accountId: 999,
			})
			.run();
		expect(() => assertAccountsResolve(deps.db)).toThrow(/account 999/);
	});
});
