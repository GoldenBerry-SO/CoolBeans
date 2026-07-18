// ABOUTME: The commercial journeys — buy, get the email, run the app, refund, renew, lapse.
// ABOUTME: Real HTTP, real SMTP delivery, real Stripe signatures, the real published SDK.

import assert from 'node:assert/strict';
import { CoolBeans } from '@coolbeans/sdk';
import { sendStripeWebhook } from './stripe-sign.mjs';

const API = process.env.JOURNEY_API ?? 'http://localhost:3098';
const MAIL = process.env.JOURNEY_MAIL ?? 'http://localhost:12112';
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
 * Emails are read back from the Resend stand-in — the provider we actually ship (§14) —
 * so these journeys exercise the Resend adapter rather than the self-host SMTP one.
 */
const inbox = async () => (await (await fetch(`${MAIL}/__sent`)).json()).messages;
const clearInbox = () => fetch(`${MAIL}/__sent`, { method: 'DELETE' });

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

console.log(`\n${passed} journey steps passed.\n`);
