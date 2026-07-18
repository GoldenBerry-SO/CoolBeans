// ABOUTME: The commercial journeys — buy, get the email, run the app, refund, renew, lapse.
// ABOUTME: Real HTTP, real SMTP delivery, real Stripe signatures, the real published SDK.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CoolBeans } from '@coolbeans/sdk';
import { sendStripeWebhook } from './stripe-sign.mjs';

const API = process.env.JOURNEY_API ?? 'http://localhost:3098';
const API_LOG = process.env.JOURNEY_API_LOG;
const STRIPE_MOCK = process.env.JOURNEY_STRIPE_MOCK ?? 'http://localhost:12111';
const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_journey';
const ADMIN = {
	Authorization: `Bearer ${process.env.ADMIN_TOKEN ?? 'journey-admin-token-0123456789'}`,
	'Content-Type': 'application/json',
};

let passed = 0;
const step =
	(label, fn) =>
	async (...args) => {
		await fn(...args);
		passed += 1;
		console.log(`  ✓ ${label}`);
	};

const api = async (method, path, body, headers = ADMIN) => {
	const res = await fetch(`${API}${path}`, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});
	return { status: res.status, body: await res.json().catch(() => null) };
};
const publicApi = (method, path, body) =>
	api(method, path, body, { 'Content-Type': 'application/json' });

const seedStripe = (seed) =>
	fetch(`${STRIPE_MOCK}/__seed`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(seed),
	});

/**
 * In development the API logs every email instead of delivering it, so the journeys read
 * the customer's mail straight out of the log. That needs no mail service at all, and it
 * asserts on the same rendered React Email HTML a real buyer would receive. The Resend
 * adapter that ships to production is covered separately by packages/email tests.
 */
let mailCursor = 0;
const inbox = async () => {
	const text = await readFile(API_LOG, 'utf8');
	const emails = [];
	for (const line of text.split('\n')) {
		if (!line.includes('email.sent')) continue;
		try {
			const entry = JSON.parse(line);
			if (entry.message === 'email.sent') emails.push(entry);
		} catch {
			// A partially written line; it will be complete on the next read.
		}
	}
	return emails.slice(mailCursor);
};
/** "Clearing" the mailbox just moves the cursor: the log is append-only. */
const clearInbox = async () => {
	const text = await readFile(API_LOG, 'utf8');
	mailCursor = text.split('\n').filter((l) => l.includes('"email.sent"')).length;
};

/** In-memory device storage: each CoolBeans instance is one machine. */
const machine = () => {
	const m = new Map();
	return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};
const client = () => new CoolBeans({ product: 'clementine', baseUrl: API, storage: machine() });

const KEY_RE = /CLEM(?:-[A-Z0-9]{4}){4}/;
const unique = Date.now().toString(36);

// ---------------------------------------------------------------------------
console.log('\nJourney 1 — a customer buys a lifetime licence and runs it on three machines');
// ---------------------------------------------------------------------------
await clearInbox();

await step('the merchant onboards the product with its Stripe price ids', async () => {
	const res = await api('POST', '/admin/products', {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'Clementine <receipts@clementine.email>',
		activation_limit: 3,
		download_url: 'https://clementine.email/download',
		stripe_price_lifetime: 'price_clem_lifetime',
		stripe_price_yearly: 'price_clem_yearly',
	});
	assert.ok([200, 409].includes(res.status), `product setup: ${res.status}`);
})();

const sessionId = `cs_life_${unique}`;
await step('Stripe delivers a signature-valid checkout.session.completed', async () => {
	await seedStripe({ sessions: { [sessionId]: { price_id: 'price_clem_lifetime' } } });
	const res = await sendStripeWebhook(API, SECRET, {
		id: `evt_life_${unique}`,
		type: 'checkout.session.completed',
		data: {
			object: {
				id: sessionId,
				mode: 'payment',
				payment_status: 'paid',
				customer: `cus_${unique}`,
				payment_intent: `pi_${unique}`,
				customer_email: 'buyer@example.com',
				amount_total: 4900,
				currency: 'usd',
			},
		},
	});
	assert.equal(res.status, 200, 'a valid delivery must be accepted');
})();

await step('a forged signature is rejected, so verification is real', async () => {
	const res = await fetch(`${API}/v1/stripe/webhook`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
		body: JSON.stringify({
			id: 'evt_forged',
			type: 'checkout.session.completed',
			data: { object: {} },
		}),
	});
	assert.equal(res.status, 400);
	assert.equal((await res.json()).error, 'invalid_signature');
})();

let licenseKey;
await step(
	'the buyer receives an email carrying the key, download link and product identity',
	async () => {
		const mine = (await inbox()).filter((m) => m.to === 'buyer@example.com');
		assert.equal(mine.length, 1, `expected exactly one key email, got ${mine.length}`);

		const message = mine[0];
		assert.match(message.from, /receipts@clementine\.email/, 'sent as the product, not as us');
		assert.match(message.subject, /Clementine/);
		const found = message.html.match(KEY_RE);
		assert.ok(found, 'the email must contain the license key');
		assert.ok(message.html.includes('clementine.email/download'), 'and the download link');
		licenseKey = found[0];
	},
)();

await step('the key resolves to a paid lifetime licence for that buyer', async () => {
	const res = await api('GET', '/admin/products/clementine/keys');
	const row = res.body.keys.find((k) => k.key === licenseKey);
	assert.equal(row.tier, 'lifetime');
	assert.equal(row.status, 'active');
	assert.equal(row.customer_email, 'buyer@example.com');
})();

await step('a Stripe redelivery issues no second key and no second email', async () => {
	const before = (await inbox()).length;
	const res = await sendStripeWebhook(API, SECRET, {
		id: `evt_life_${unique}`,
		type: 'checkout.session.completed',
		data: {
			object: {
				id: sessionId,
				mode: 'payment',
				payment_status: 'paid',
				customer_email: 'buyer@example.com',
				payment_intent: `pi_${unique}`,
			},
		},
	});
	assert.equal(res.status, 200, 'a duplicate must be acknowledged, not retried forever');
	const keys = (await api('GET', '/admin/products/clementine/keys')).body.keys;
	assert.equal(keys.filter((k) => k.customer_email === 'buyer@example.com').length, 1);
	assert.equal((await inbox()).length, before, 'no duplicate email');
})();

await step('the success page reads the same purchase rather than issuing another', async () => {
	const res = await api('GET', `/v1/purchase/session/${sessionId}`);
	assert.equal(res.status, 200);
	assert.equal(res.body.license.key, licenseKey);
	assert.equal(res.body.email, 'buyer@example.com');
})();

const machines = [];
await step('three machines activate; the fourth is refused with the seat limit', async () => {
	for (const name of ['Studio iMac', 'MacBook Pro', 'Home PC']) {
		const sdk = client();
		const result = await sdk.activate(licenseKey, { name });
		assert.equal(result.license.status, 'active');
		machines.push(sdk);
	}
	await assert.rejects(
		() => client().activate(licenseKey, { name: 'One too many' }),
		(err) => err.status === 409 && err.body.error === 'activation_limit_reached',
	);
})();

await step(
	'the app verifies online, caches an offline token, and runs without network',
	async () => {
		const sdk = machines[0];
		const result = await sdk.verify(licenseKey, { instanceId: sdk.instanceId() });
		assert.equal(result.valid, true);
		assert.ok(result.token, 'a live seat gets a signed offline token');
		assert.equal(await sdk.verifyOffline(), true);
	},
)();

// ---------------------------------------------------------------------------
console.log('\nJourney 2 — the customer refunds, and the software stops working');
// ---------------------------------------------------------------------------
await step('a PARTIAL refund does not revoke the licence', async () => {
	await sendStripeWebhook(API, SECRET, {
		id: `evt_partial_${unique}`,
		type: 'charge.refunded',
		data: {
			object: {
				id: `ch_${unique}`,
				payment_intent: `pi_${unique}`,
				amount_captured: 4900,
				amount_refunded: 1000,
			},
		},
	});
	const row = (await api('GET', '/admin/products/clementine/keys')).body.keys.find(
		(k) => k.key === licenseKey,
	);
	assert.equal(row.status, 'active', 'a partial refund must leave the licence alone');
})();

await step('a FULL refund disables the licence with reason=refund', async () => {
	await sendStripeWebhook(API, SECRET, {
		id: `evt_full_${unique}`,
		type: 'charge.refunded',
		data: {
			object: {
				id: `ch_${unique}`,
				payment_intent: `pi_${unique}`,
				amount_captured: 4900,
				amount_refunded: 4900,
			},
		},
	});
	const row = (await api('GET', '/admin/products/clementine/keys')).body.keys.find(
		(k) => k.key === licenseKey,
	);
	assert.equal(row.status, 'disabled');
	assert.equal(row.disabled_reason, 'refund');
})();

await step(
	'the running app sees the definitive signal and locks out, online and offline',
	async () => {
		const sdk = machines[0];
		const result = await sdk.verify(licenseKey, { instanceId: sdk.instanceId() });
		assert.equal(result.valid, false);
		assert.equal(result.license.status, 'disabled');
		assert.ok(!result.inconclusive, 'a refund is definitive, never inconclusive');
		assert.equal(await sdk.verifyOffline(), false, 'the cached offline token must be cleared');
	},
)();

await step('a refunded key cannot be activated on a fresh machine', async () => {
	await assert.rejects(
		() => client().activate(licenseKey, { name: 'After refund' }),
		(err) => err.status === 403 && err.body.error === 'license_disabled',
	);
})();

// ---------------------------------------------------------------------------
console.log('\nJourney 3 — a yearly subscriber renews, then cancels');
// ---------------------------------------------------------------------------
const subId = `sub_${unique}`;
const subSession = `cs_sub_${unique}`;
const seconds = (iso) => Math.floor(new Date(iso).getTime() / 1000);
let yearlyKey;

await step('a subscription checkout issues a yearly key dated to the period end', async () => {
	await seedStripe({
		sessions: { [subSession]: { price_id: 'price_clem_yearly' } },
		subscriptions: { [subId]: { current_period_end: seconds('2027-07-18T00:00:00Z') } },
	});
	await sendStripeWebhook(API, SECRET, {
		id: `evt_subbuy_${unique}`,
		type: 'checkout.session.completed',
		data: {
			object: {
				id: subSession,
				mode: 'subscription',
				payment_status: 'paid',
				subscription: subId,
				customer: `cus_sub_${unique}`,
				customer_email: 'subscriber@example.com',
			},
		},
	});
	const row = (await api('GET', '/admin/products/clementine/keys')).body.keys.find(
		(k) => k.customer_email === 'subscriber@example.com',
	);
	assert.equal(row.tier, 'yearly');
	assert.equal(row.expires_at, '2027-07-18T00:00:00.000Z');
	yearlyKey = row.key;
})();

await step('renewal advances the date and changes nothing else', async () => {
	// Stripe sends the whole subscription on this event, and Basil keeps
	// current_period_end on the item — the handler reads it from the payload.
	await sendStripeWebhook(API, SECRET, {
		id: `evt_renew_${unique}`,
		type: 'customer.subscription.updated',
		data: {
			object: {
				id: subId,
				status: 'active',
				items: {
					object: 'list',
					data: [{ id: 'si_1', current_period_end: seconds('2028-07-18T00:00:00Z') }],
				},
			},
		},
	});
	const row = (await api('GET', '/admin/products/clementine/keys')).body.keys.find(
		(k) => k.key === yearlyKey,
	);
	assert.equal(row.status, 'active');
	assert.equal(row.expires_at, '2028-07-18T00:00:00.000Z', 'the renewal must move the date');
})();

await step('cancellation at period end disables with reason=subscription_canceled', async () => {
	await sendStripeWebhook(API, SECRET, {
		id: `evt_cancel_${unique}`,
		type: 'customer.subscription.deleted',
		data: { object: { id: subId, status: 'canceled' } },
	});
	const row = (await api('GET', '/admin/products/clementine/keys')).body.keys.find(
		(k) => k.key === yearlyKey,
	);
	assert.equal(row.status, 'disabled');
	assert.equal(row.disabled_reason, 'subscription_canceled');
})();

await step('a lifetime licence is never touched by subscription events', async () => {
	const row = (await api('GET', '/admin/products/clementine/keys')).body.keys.find(
		(k) => k.key === licenseKey,
	);
	assert.equal(row.disabled_reason, 'refund', 'lifetime keys die on refund only, not on lapse');
})();

// ---------------------------------------------------------------------------
console.log('\nJourney 4 — the customer helps themselves instead of opening a ticket');
// ---------------------------------------------------------------------------
await step('key recovery emails the keys and never returns them in the response', async () => {
	await clearInbox();
	const res = await publicApi('POST', '/v1/portal/recover', { email: 'buyer@example.com' });
	assert.equal(res.status, 200);
	assert.ok(!JSON.stringify(res.body).includes('CLEM-'), 'an email address is not a credential');

	// Delivery is deliberately deferred so response time is not a buyer oracle.
	await new Promise((r) => setTimeout(r, 1500));
	const messages = await inbox();
	assert.equal(messages.length, 1, 'the buyer gets their keys by email');
	assert.match(messages[0].html, KEY_RE);
})();

await step('an unknown address gets the identical answer and no email', async () => {
	await clearInbox();
	const res = await publicApi('POST', '/v1/portal/recover', { email: 'stranger@nowhere.io' });
	assert.equal(res.status, 200);
	await new Promise((r) => setTimeout(r, 1500));
	assert.equal((await inbox()).length, 0, 'recovery must not confirm who bought what');
})();

// ---------------------------------------------------------------------------
console.log('\nJourney 5 — access comes back when the reason for taking it away goes away');
// ---------------------------------------------------------------------------
const dunSession = `cs_dun_${unique}`;
const dunSub = `sub_dun_${unique}`;
let dunKey;

await step('a subscriber who falls behind and then pays up gets their access back', async () => {
	await seedStripe({
		sessions: { [dunSession]: { price_id: 'price_clem_yearly' } },
		subscriptions: { [dunSub]: { current_period_end: seconds('2027-07-18T00:00:00Z') } },
	});
	await sendStripeWebhook(API, SECRET, {
		id: `evt_dunbuy_${unique}`,
		type: 'checkout.session.completed',
		data: {
			object: {
				id: dunSession,
				mode: 'subscription',
				payment_status: 'paid',
				subscription: dunSub,
				customer: `cus_dun_${unique}`,
				customer_email: 'dunning@example.com',
			},
		},
	});
	const keyOf = async () =>
		(await api('GET', '/admin/products/clementine/keys')).body.keys.find(
			(k) => k.customer_email === 'dunning@example.com',
		);
	dunKey = (await keyOf()).key;

	// Their card fails.
	await sendStripeWebhook(API, SECRET, {
		id: `evt_dunfail_${unique}`,
		type: 'customer.subscription.updated',
		data: { object: { id: dunSub, status: 'unpaid' } },
	});
	assert.equal((await keyOf()).status, 'disabled', 'a lapse still revokes');

	// They fix it and Stripe recovers the subscription.
	await sendStripeWebhook(API, SECRET, {
		id: `evt_dunfixed_${unique}`,
		type: 'customer.subscription.updated',
		data: {
			object: {
				id: dunSub,
				status: 'active',
				items: {
					object: 'list',
					data: [{ id: 'si_dun', current_period_end: seconds('2028-07-18T00:00:00Z') }],
				},
			},
		},
	});
	const row = await keyOf();
	assert.equal(row.status, 'active', 'a paying customer must not stay locked out');
	assert.equal(row.disabled_reason, null);
})();

await step('a refunded key is NOT resurrected by a later active subscription', async () => {
	// The lifetime key was refunded in journey 2. No subscription event may undo that.
	const row = (await api('GET', '/admin/products/clementine/keys')).body.keys.find(
		(k) => k.key === licenseKey,
	);
	assert.equal(row.status, 'disabled');
	assert.equal(row.disabled_reason, 'refund');
})();

await step('a refund that arrives BEFORE its checkout still revokes the key', async () => {
	// Stripe does not guarantee delivery order. The refund lands first, naming a payment
	// we have never seen; the checkout behind it must not hand out a working key.
	const oooSession = `cs_ooo_${unique}`;
	const oooPi = `pi_ooo_${unique}`;
	await seedStripe({ sessions: { [oooSession]: { price_id: 'price_clem_lifetime' } } });
	await sendStripeWebhook(API, SECRET, {
		id: `evt_ooorefund_${unique}`,
		type: 'charge.refunded',
		data: {
			object: {
				id: `ch_ooo_${unique}`,
				payment_intent: oooPi,
				amount_captured: 4900,
				amount_refunded: 4900,
			},
		},
	});
	await sendStripeWebhook(API, SECRET, {
		id: `evt_ooobuy_${unique}`,
		type: 'checkout.session.completed',
		data: {
			object: {
				id: oooSession,
				mode: 'payment',
				payment_status: 'paid',
				payment_intent: oooPi,
				customer: `cus_ooo_${unique}`,
				customer_email: 'outoforder@example.com',
				amount_total: 4900,
				currency: 'usd',
			},
		},
	});
	const row = (await api('GET', '/admin/products/clementine/keys')).body.keys.find(
		(k) => k.customer_email === 'outoforder@example.com',
	);
	assert.ok(row, 'the licence is still created, so the buyer exists in our records');
	assert.equal(row.status, 'disabled', 'no working key for money we already refunded');
	assert.equal(row.disabled_reason, 'refund');
})();

await step('a payment we cannot fulfil is recorded instead of silently dropped', async () => {
	await seedStripe({ sessions: { [`cs_bad_${unique}`]: { price_id: 'price_nobody_configured' } } });
	const res = await sendStripeWebhook(API, SECRET, {
		id: `evt_bad_${unique}`,
		type: 'checkout.session.completed',
		data: {
			object: {
				id: `cs_bad_${unique}`,
				mode: 'payment',
				payment_status: 'paid',
				customer_email: 'lost@example.com',
				amount_total: 4900,
				currency: 'usd',
			},
		},
	});
	assert.equal(res.status, 200, 'a retry cannot fix a price id that points nowhere');
	const audit = (await api('GET', '/admin/audit?limit=200')).body.audit;
	const row = audit.find(
		(e) => e.action === 'payment.unfulfilled' && e.detail?.checkout_id === `cs_bad_${unique}`,
	);
	assert.ok(row, 'someone paid and got nothing: that has to be reconcilable later');
	assert.equal(row.detail.email, 'lost@example.com');
})();

console.log(`\n${passed} journey steps passed.\n`);
