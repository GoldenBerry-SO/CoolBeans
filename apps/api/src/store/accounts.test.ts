// ABOUTME: Tests the account store and the boot check that once substituted for missing foreign keys.
// ABOUTME: The Postgres FKs now make orphans unrepresentable; the boot check remains as their proof.

import { products } from '@coolbeans/db';
import { describe, expect, it } from 'vitest';
import { makeHarness } from '../test/harness.js';
import {
	assertAccountsResolve,
	countAccounts,
	createAccount,
	DEFAULT_ACCOUNT_ID,
	findAccountsByName,
	getAccountById,
} from './accounts.js';

describe('account store', () => {
	it('a migrated database starts with exactly one account', async () => {
		const { deps } = await makeHarness();
		expect(await countAccounts(deps.db)).toBe(1);
		expect((await getAccountById(deps.db, DEFAULT_ACCOUNT_ID))?.plan).toBe('pro');
	});

	it('creates accounts on the free plan', async () => {
		const { deps } = await makeHarness();
		const account = await createAccount(deps.db, 'acme.com');
		// Never 'pro': gifting Pro later is easy, taking it back is not.
		expect(account.plan).toBe('free');
		expect((await findAccountsByName(deps.db, 'acme.com')).map((a) => a.id)).toEqual([account.id]);
	});

	it('returns every account sharing a name, since names are not unique', async () => {
		// Two signups from the same email domain both default to that domain, so callers
		// have to handle the collision rather than take whichever row came back first.
		const { deps } = await makeHarness();
		await createAccount(deps.db, 'acme.com');
		await createAccount(deps.db, 'acme.com');
		expect(await findAccountsByName(deps.db, 'acme.com')).toHaveLength(2);
	});

	it('passes the boot check on a healthy database', async () => {
		const { deps } = await makeHarness();
		await deps.db
			.insert(products)
			.values({ slug: 'clementine', name: 'Clementine', keyPrefix: 'CLEM', emailFrom: 'r@c.io' });
		await expect(assertAccountsResolve(deps.db)).resolves.not.toThrow();
	});

	it('the database itself refuses a product pointing at an account that does not exist', async () => {
		// Under SQLite this row could be written and only assertAccountsResolve stood
		// between it and a cross-tenant read at runtime. The Postgres port added the real
		// foreign key, so the broken state is now unrepresentable: the insert fails at the
		// database, which is a strictly stronger guarantee than catching it at next boot.
		// assertAccountsResolve stays for one release as the proof the constraint took on
		// a migrated database (the healthy-path test above), not as the enforcement.
		const { deps } = await makeHarness();
		await expect(
			deps.db.insert(products).values({
				slug: 'clementine',
				name: 'Clementine',
				keyPrefix: 'CLEM',
				emailFrom: 'r@c.io',
				accountId: 999,
			}),
		).rejects.toThrow();
		// And nothing landed: the table is exactly as empty as before the attempt.
		await expect(assertAccountsResolve(deps.db)).resolves.not.toThrow();
	});
});
