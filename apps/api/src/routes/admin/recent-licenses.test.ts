// ABOUTME: GET /admin/licenses — the account's most recent licences for the Overview card (#60).
// ABOUTME: Recent-first, capped, and account-scoped so one tenant never sees another's keys.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../../config.js';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, issueKey, signUp } from '../../test/seed.js';

let h: TestHarness;

// Billing configured puts the harness in cloud mode, where signup opens a new account.
const cloud: Partial<Config> = {
	logMagicCodes: true,
	billing: { stripeSecretKey: 'sk_test', proPriceId: 'price_test' },
};

async function issue(email: string): Promise<void> {
	const res = await h.app.request('/admin/keys', {
		method: 'POST',
		headers: h.adminHeaders,
		body: JSON.stringify({ product: 'clementine', email, tier: 'lifetime' }),
	});
	if (res.status !== 200) throw new Error(`issue failed: ${res.status} ${await res.text()}`);
}

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
});

describe('GET /admin/licenses', () => {
	it('returns the account licences newest first', async () => {
		await issue('first@buyer.test');
		await issue('second@buyer.test');
		const res = await h.app.request('/admin/licenses', { headers: h.adminHeaders });
		expect(res.status).toBe(200);
		const { keys } = (await res.json()) as {
			keys: Array<{ customer_email: string; product: string }>;
		};
		expect(keys).toHaveLength(2);
		// Most recent issue is first.
		expect(keys[0]?.customer_email).toBe('second@buyer.test');
		expect(keys[0]?.product).toBe('clementine');
	});

	it('caps the result at the requested limit', async () => {
		await issue('a@buyer.test');
		await issue('b@buyer.test');
		await issue('c@buyer.test');
		const res = await h.app.request('/admin/licenses?limit=2', { headers: h.adminHeaders });
		const { keys } = (await res.json()) as { keys: unknown[] };
		expect(keys).toHaveLength(2);
	});

	it('rejects a non-positive limit', async () => {
		const res = await h.app.request('/admin/licenses?limit=0', { headers: h.adminHeaders });
		expect(res.status).toBe(400);
	});
});

describe('GET /admin/licenses is account-scoped', () => {
	it("never returns another account's licences", async () => {
		const h2 = await makeHarness({ config: cloud });
		const alice = await signUp(h2.app, h2.logger, 'alice@alpha.test', 'alpha');
		const bob = await signUp(h2.app, h2.logger, 'bob@beta.test', 'beta');
		await createProduct(
			h2.app,
			{ slug: 'alpha-app', name: 'Alpha', key_prefix: 'ALPHA', email_from: 'a@alpha.test' },
			alice,
		);
		await issueKey(
			h2.app,
			{ product: 'alpha-app', email: 'buyer@alpha.test', tier: 'lifetime' },
			alice,
		);

		// Alice sees her own licence; Bob, a separate account with none, sees an empty list.
		const aliceRes = await h2.app.request('/admin/licenses', { headers: alice });
		expect(((await aliceRes.json()) as { keys: unknown[] }).keys).toHaveLength(1);
		const bobRes = await h2.app.request('/admin/licenses', { headers: bob });
		expect(bobRes.status).toBe(200);
		expect(((await bobRes.json()) as { keys: unknown[] }).keys).toHaveLength(0);
	});
});
