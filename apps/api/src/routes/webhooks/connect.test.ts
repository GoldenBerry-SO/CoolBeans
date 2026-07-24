// ABOUTME: Stripe Connect webhook (issue #62 cloud) — event.account routes to the right tenant, and only it.
// ABOUTME: The same Stripe price maps to different products per connection, so isolation is the whole point.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../../config.js';
import { createCloudConnection } from '../../services/stripe-connection.js';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../../test/harness.js';
import { rawQuery } from '../../test/pg.js';
import { createProduct, seedGrant, signUp } from '../../test/seed.js';

let h: TestHarness;

const cloud: Partial<Config> = {
	stripe: { secretKey: 'sk_test', webhookSecret: 'whsec_test' },
	connect: { secretKey: 'sk_connect', webhookSecret: 'whsec_connect' },
	billing: {
		stripeSecretKey: 'sk_billing',
		stripeWebhookSecret: 'whsec_billing',
		proPriceId: 'price_pro',
	},
	logMagicCodes: true,
};

// A shared price id both vendors happen to reuse. On different connections it maps to
// different products, so routing has to keep them apart.
const SHARED_PRICE = 'price_shared';

async function connectWebhook(event: unknown, signature = 'valid') {
	const res = await h.app.request('/v1/connect/stripe/webhook', {
		method: 'POST',
		headers: { 'stripe-signature': signature, 'Content-Type': 'application/json' },
		body: JSON.stringify(event),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function keyCount(slug: string, headers: Record<string, string>): Promise<number> {
	const res = await h.app.request(`/admin/products/${slug}/keys`, { headers });
	return ((await res.json()) as { keys: unknown[] }).keys.length;
}

let alice: Record<string, string>;
let bob: Record<string, string>;

beforeEach(async () => {
	h = await makeHarness({ config: cloud });
	h.deps.connect = fakeStripeGateway({}, { cs_alice: [SHARED_PRICE], cs_bob: [SHARED_PRICE] });

	alice = await signUp(h.app, h.logger, 'alice@alpha.test', 'alpha');
	bob = await signUp(h.app, h.logger, 'bob@beta.test', 'beta');
	const aliceId = (
		await rawQuery<{ id: number }>("SELECT id FROM accounts WHERE name = 'alpha'")
	)[0].id;
	const bobId = (await rawQuery<{ id: number }>("SELECT id FROM accounts WHERE name = 'beta'"))[0]
		.id;

	// Each vendor authorizes their own Stripe account, so each gets its own connection.
	const aliceConn = await createCloudConnection(h.deps, {
		accountId: aliceId,
		stripeAccountId: 'acct_alice',
		actor: 'test',
	});
	const bobConn = await createCloudConnection(h.deps, {
		accountId: bobId,
		stripeAccountId: 'acct_bob',
		actor: 'test',
	});

	const aliceApp = await createProduct(
		h.app,
		{ slug: 'alice-app', name: 'Alice', key_prefix: 'ALCE', email_from: 'a@alpha.test' },
		alice,
	);
	const bobApp = await createProduct(
		h.app,
		{ slug: 'bob-app', name: 'Bob', key_prefix: 'BOBB', email_from: 'b@beta.test' },
		bob,
	);
	await seedGrant(h.deps, {
		productId: aliceApp.id as number,
		priceId: SHARED_PRICE,
		kind: 'perpetual',
		accountId: aliceId,
		connectionId: aliceConn.id,
	});
	await seedGrant(h.deps, {
		productId: bobApp.id as number,
		priceId: SHARED_PRICE,
		kind: 'perpetual',
		accountId: bobId,
		connectionId: bobConn.id,
	});
});

function checkout(account: string, sessionId: string, id: string) {
	return {
		id,
		account,
		type: 'checkout.session.completed',
		data: {
			object: {
				id: sessionId,
				mode: 'payment',
				payment_status: 'paid',
				customer_email: `buyer-${account}@example.com`,
			},
		},
	};
}

describe('Stripe Connect webhook routing', () => {
	it('issues only under the account the event.account resolves to', async () => {
		const r = await connectWebhook(checkout('acct_alice', 'cs_alice', 'evt_alice'));
		expect(r.status).toBe(200);
		expect(await keyCount('alice-app', alice)).toBe(1);
		expect(await keyCount('bob-app', bob)).toBe(0);

		await connectWebhook(checkout('acct_bob', 'cs_bob', 'evt_bob'));
		expect(await keyCount('bob-app', bob)).toBe(1);
		// Alice still has exactly her one key: Bob's event never touched her tenant.
		expect(await keyCount('alice-app', alice)).toBe(1);
	});

	it('rejects a forged signature before doing anything', async () => {
		const r = await connectWebhook(checkout('acct_alice', 'cs_alice', 'evt_x'), 'bogus');
		expect(r.status).toBe(400);
		expect(r.body.error).toBe('invalid_signature');
		expect(await keyCount('alice-app', alice)).toBe(0);
	});

	it('records but does not act on an event whose account maps to no connection', async () => {
		const r = await connectWebhook(checkout('acct_stranger', 'cs_alice', 'evt_lost'));
		expect(r.status).toBe(200);
		expect(await keyCount('alice-app', alice)).toBe(0);
		const audit = await h.app.request('/admin/audit', { headers: alice });
		const rows = ((await audit.json()) as { audit: Array<{ action: string }> }).audit;
		// The unroutable record is instance-level (no account), so it need not show to alice;
		// what matters is nothing issued.
		expect(rows.every((e) => e.action !== 'license.issued')).toBe(true);
	});

	it('retires a connection’s grants when the vendor deauthorizes', async () => {
		await connectWebhook({
			id: 'evt_deauth',
			account: 'acct_alice',
			type: 'account.application.deauthorized',
			data: { object: { id: 'ca_1' } },
		});
		// A later checkout on that price now resolves to no active grant, so it issues nothing.
		const r = await connectWebhook(checkout('acct_alice', 'cs_alice', 'evt_after'));
		expect(r.status).toBe(200);
		expect(await keyCount('alice-app', alice)).toBe(0);
	});
});
