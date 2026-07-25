// ABOUTME: The Stripe Connect authorization handshake (issue #62 cloud) — CSRF state and code exchange.
// ABOUTME: The state is the only thing binding a public callback to an account, so it is the thing under test.

import { stripeConnectStates } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../test/harness.js';
import { rawQuery } from '../test/pg.js';
import { signUp } from '../test/seed.js';
import { disconnectConnection } from './stripe-connection.js';
import {
	completeConnectAuthorization,
	connectStateHash,
	pruneConnectStates,
	startConnectAuthorization,
} from './stripe-onboarding.js';

let h: TestHarness;
let aliceId: number;
let bobId: number;

const cloud: Partial<Config> = {
	stripe: { secretKey: 'sk', webhookSecret: 'wh' },
	connect: { secretKey: 'sk_c', clientId: 'ca_platform', webhookSecret: 'wh_c' },
	billing: { stripeSecretKey: 'sk_b', stripeWebhookSecret: 'wh_b', proPriceId: 'price_pro' },
	logMagicCodes: true,
};

beforeEach(async () => {
	h = await makeHarness({ config: cloud });
	h.deps.connect = fakeStripeGateway(undefined, undefined, {
		connectCodes: {
			ac_alice: { stripeAccountId: 'acct_alice' },
			ac_bob: { stripeAccountId: 'acct_bob' },
		},
	});
	await signUp(h.app, h.logger, 'alice@alpha.test', 'alpha');
	await signUp(h.app, h.logger, 'bob@beta.test', 'beta');
	aliceId = (await rawQuery<{ id: number }>("SELECT id FROM accounts WHERE name = 'alpha'"))[0].id;
	bobId = (await rawQuery<{ id: number }>("SELECT id FROM accounts WHERE name = 'beta'"))[0].id;
});

describe('starting authorization', () => {
	it('builds a Stripe URL carrying our client id, scope, redirect and state', async () => {
		const { url, state } = await startConnectAuthorization(h.deps, { accountId: aliceId });
		const parsed = new URL(url);
		expect(parsed.origin + parsed.pathname).toBe('https://connect.stripe.com/oauth/authorize');
		expect(parsed.searchParams.get('client_id')).toBe('ca_platform');
		expect(parsed.searchParams.get('response_type')).toBe('code');
		expect(parsed.searchParams.get('scope')).toBe('read_write');
		expect(parsed.searchParams.get('redirect_uri')).toContain('/v1/connect/stripe/callback');
		expect(parsed.searchParams.get('state')).toBe(state);
	});

	it('stores only a hash of the state, never the state itself', async () => {
		const { state } = await startConnectAuthorization(h.deps, { accountId: aliceId });
		const [row] = await h.deps.db
			.select()
			.from(stripeConnectStates)
			.where(eq(stripeConnectStates.stateHash, connectStateHash(state)));
		expect(row).toBeDefined();
		const all = await rawQuery<{ state_hash: string }>(
			'SELECT state_hash FROM stripe_connect_states',
		);
		expect(all.every((r) => r.state_hash !== state)).toBe(true);
	});

	it('refuses to start when no Connect client id is configured', async () => {
		const bare = await makeHarness({ config: { stripe: { secretKey: 'sk', webhookSecret: 'w' } } });
		await expect(startConnectAuthorization(bare.deps, { accountId: 1 })).rejects.toThrow(
			/not configured/i,
		);
	});
});

describe('completing authorization', () => {
	it('binds the authorized Stripe account to the account that STARTED the handshake', async () => {
		const { state } = await startConnectAuthorization(h.deps, { accountId: aliceId });
		const connection = await completeConnectAuthorization(h.deps, { code: 'ac_alice', state });
		expect(connection.accountId).toBe(aliceId);
		expect(connection.stripeAccountId).toBe('acct_alice');
		expect(connection.mode).toBe('cloud_connect');
		expect(connection.status).toBe('active');
	});

	it('cannot be replayed: the state is spent on first use', async () => {
		const { state } = await startConnectAuthorization(h.deps, { accountId: aliceId });
		await completeConnectAuthorization(h.deps, { code: 'ac_alice', state });
		await expect(completeConnectAuthorization(h.deps, { code: 'ac_alice', state })).rejects.toThrow(
			/no longer valid/i,
		);
	});

	it('refuses a state we never issued (the CSRF case)', async () => {
		// Without this an attacker replays the public callback with their own Stripe code and
		// attaches their account to somebody else's tenant.
		await expect(
			completeConnectAuthorization(h.deps, { code: 'ac_bob', state: 'not-a-state-we-minted' }),
		).rejects.toThrow(/no longer valid/i);
	});

	it('refuses a state that has gone stale', async () => {
		const { state } = await startConnectAuthorization(h.deps, { accountId: aliceId });
		// Real expiry by the clock, not by editing the row: the vendor wandered off and came
		// back an hour later, and the link should no longer bind anything.
		h.clock.advance(16 * 60_000);
		await expect(completeConnectAuthorization(h.deps, { code: 'ac_alice', state })).rejects.toThrow(
			/no longer valid/i,
		);
	});

	it("uses ALICE's state even if the code is Bob's, so a swapped code cannot cross tenants", async () => {
		// The state decides the tenant, the code decides the Stripe account. A mismatch binds
		// the Stripe account to whoever started the handshake, never the other way round.
		const { state } = await startConnectAuthorization(h.deps, { accountId: aliceId });
		const connection = await completeConnectAuthorization(h.deps, { code: 'ac_bob', state });
		expect(connection.accountId).toBe(aliceId);
		expect(connection.stripeAccountId).toBe('acct_bob');
	});

	it('refuses when Stripe will not honour the code', async () => {
		const { state } = await startConnectAuthorization(h.deps, { accountId: aliceId });
		await expect(
			completeConnectAuthorization(h.deps, { code: 'ac_forged', state }),
		).rejects.toThrow(/would not confirm/i);
	});

	it('spends the state even when the code then fails, so a bad attempt is not retryable', async () => {
		const { state } = await startConnectAuthorization(h.deps, { accountId: aliceId });
		await expect(
			completeConnectAuthorization(h.deps, { code: 'ac_forged', state }),
		).rejects.toThrow();
		await expect(completeConnectAuthorization(h.deps, { code: 'ac_alice', state })).rejects.toThrow(
			/no longer valid/i,
		);
	});

	it('re-authorizing the same Stripe account reactivates its connection rather than duplicating', async () => {
		const first = await startConnectAuthorization(h.deps, { accountId: aliceId });
		const a = await completeConnectAuthorization(h.deps, { code: 'ac_alice', state: first.state });
		const second = await startConnectAuthorization(h.deps, { accountId: aliceId });
		const b = await completeConnectAuthorization(h.deps, { code: 'ac_alice', state: second.state });
		expect(b.id).toBe(a.id);
		const rows = await rawQuery<{ n: number }>(
			"SELECT count(*)::int n FROM stripe_connections WHERE stripe_account_id = 'acct_alice'",
		);
		expect(rows[0]?.n).toBe(1);
	});

	it('two tenants each get their own connection', async () => {
		const one = await startConnectAuthorization(h.deps, { accountId: aliceId });
		const two = await startConnectAuthorization(h.deps, { accountId: bobId });
		const a = await completeConnectAuthorization(h.deps, { code: 'ac_alice', state: one.state });
		const b = await completeConnectAuthorization(h.deps, { code: 'ac_bob', state: two.state });
		expect(a.accountId).toBe(aliceId);
		expect(b.accountId).toBe(bobId);
		expect(a.id).not.toBe(b.id);
	});
});

describe('housekeeping', () => {
	it('prunes expired unused states but keeps spent ones for the trail', async () => {
		await startConnectAuthorization(h.deps, { accountId: aliceId }); // never used
		const used = await startConnectAuthorization(h.deps, { accountId: aliceId });
		await completeConnectAuthorization(h.deps, { code: 'ac_alice', state: used.state });
		h.clock.advance(16 * 60_000);
		await pruneConnectStates(h.deps);
		const left = await rawQuery<{ n: number }>('SELECT count(*)::int n FROM stripe_connect_states');
		expect(left[0]?.n).toBe(1);
	});
});

describe('one Stripe account, one tenant', () => {
	it('refuses to bind a Stripe account another tenant already holds', async () => {
		// Otherwise the upsert leaves the connection under the first tenant and tells the
		// second one it succeeded, so their grants then fail with "not connected" forever.
		const first = await startConnectAuthorization(h.deps, { accountId: aliceId });
		await completeConnectAuthorization(h.deps, { code: 'ac_alice', state: first.state });
		const second = await startConnectAuthorization(h.deps, { accountId: bobId });
		await expect(
			completeConnectAuthorization(h.deps, { code: 'ac_alice', state: second.state }),
		).rejects.toThrow(/already connected to a different/i);
	});

	it("does not let another tenant's authorization revive a disconnected connection", async () => {
		const first = await startConnectAuthorization(h.deps, { accountId: aliceId });
		const conn = await completeConnectAuthorization(h.deps, {
			code: 'ac_alice',
			state: first.state,
		});
		await disconnectConnection(h.deps, { stripeAccountId: 'acct_alice', actor: 'test' });
		const second = await startConnectAuthorization(h.deps, { accountId: bobId });
		await expect(
			completeConnectAuthorization(h.deps, { code: 'ac_alice', state: second.state }),
		).rejects.toThrow(/already connected to a different/i);
		const [row] = await rawQuery<{ status: string; account_id: number }>(
			`SELECT status, account_id FROM stripe_connections WHERE id = ${conn.id}`,
		);
		expect(row?.status).toBe('disconnected');
		expect(row?.account_id).toBe(aliceId);
	});

	it('the owning tenant can still re-authorize and come back', async () => {
		const first = await startConnectAuthorization(h.deps, { accountId: aliceId });
		const conn = await completeConnectAuthorization(h.deps, {
			code: 'ac_alice',
			state: first.state,
		});
		await disconnectConnection(h.deps, { stripeAccountId: 'acct_alice', actor: 'test' });
		const again = await startConnectAuthorization(h.deps, { accountId: aliceId });
		const back = await completeConnectAuthorization(h.deps, {
			code: 'ac_alice',
			state: again.state,
		});
		expect(back.id).toBe(conn.id);
		expect(back.status).toBe('active');
	});
});
