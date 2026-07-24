// ABOUTME: End-to-end simulation (PRD §20, §33) — real @coolbeans/sdk apps drive a real server.
// ABOUTME: Every lifecycle flow against seeded fixtures; no mocks, real SQLite, real signed tokens.

import { CoolBeans } from '@coolbeans/sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeStripeGateway, makeHarness, type TestHarness } from './harness.js';
import { createProduct, defineMetric, issueKey, post } from './seed.js';

let h: TestHarness;

/** Route the SDK's absolute-URL fetch into the in-process app (no socket needed). */
function appFetch(app: TestHarness['app']): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		return app.request(
			url.pathname + url.search,
			init ?? (input instanceof Request ? input : undefined),
		);
	}) as typeof fetch;
}

function memStorage() {
	const m = new Map<string, string>();
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
	};
}

function sdk(product: string) {
	return new CoolBeans({
		product,
		baseUrl: 'http://server.test',
		storage: memStorage(),
		fetch: appFetch(h.app),
	});
}

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
		activation_limit: 3,
	});
});

describe('E2E: desktop app lifecycle', () => {
	it('activate -> verify online -> verify offline -> deactivate frees the seat', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'buyer@example.com',
			kind: 'subscription',
		});
		const cb = sdk('clementine');

		const { instance } = await cb.activate(key, { name: cb.fingerprint() });
		expect(instance.id).toBeTruthy();

		const online = await cb.verify(key, { instanceId: instance.id });
		expect(online.valid).toBe(true);
		expect(online.token).toBeTruthy();

		// Offline path: verify the cached, server-signed token locally against fetched public keys.
		expect(await cb.verifyOffline()).toBe(true);
		expect(await cb.offlineState()).toBe('valid');

		await cb.deactivate(key, { instanceId: instance.id });
		// After deactivation the seat is free: three fresh devices fit under the limit of 3.
		for (const name of ['a', 'b', 'c']) {
			const r = await post(h.app, '/v1/activate', { license_key: key, instance_name: name });
			expect(r.status).toBe(200);
		}
	});
});

describe('E2E: seat exhaustion and recovery', () => {
	it('N+1 is refused, portal deactivate frees a seat, retry succeeds', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'b@x.io',
			kind: 'perpetual',
		});
		const ids: string[] = [];
		for (let i = 0; i < 3; i++) {
			const r = await post(h.app, '/v1/activate', { license_key: key, instance_name: `dev-${i}` });
			ids.push((r.body.instance as { id: string }).id);
		}
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'dev-4' })).status,
		).toBe(409);
		await post(h.app, '/v1/deactivate', { license_key: key, instance_id: ids[0] });
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'dev-4' })).status,
		).toBe(200);
	});

	it('same device reactivation reuses the instance without burning a seat', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'b@x.io',
			kind: 'perpetual',
		});
		const first = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Mac' });
		const again = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Mac' });
		expect((first.body.instance as { id: string }).id).toBe(
			(again.body.instance as { id: string }).id,
		);
	});
});

describe('E2E: disabled key is the definitive revocation signal', () => {
	it('refund disables; validate returns disabled, activate fails closed, unknown stays 404', async () => {
		h.deps.config.stripe = { secretKey: 'sk', webhookSecret: 'wh' };
		h.deps.stripe = fakeStripeGateway();
		// Buy via Stripe.
		await h.app.request('/v1/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 'evt_1',
				type: 'checkout.session.completed',
				data: {
					object: {
						id: 'cs_1',
						mode: 'payment',
						payment_status: 'paid',
						payment_intent: 'pi_1',
						customer_email: 'b@x.io',
						metadata: { product: 'clementine' },
					},
				},
			}),
		});
		const listed = await h.app.request('/admin/products/clementine/keys?email=b@x.io', {
			headers: h.adminHeaders,
		});
		const key = ((await listed.json()) as { keys: Array<{ key: string }> }).keys[0].key;
		const act = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Mac' });
		const instanceId = (act.body.instance as { id: string }).id;

		// Refund.
		await h.app.request('/v1/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 'evt_refund',
				type: 'charge.refunded',
				data: {
					object: {
						id: 'ch_1',
						payment_intent: 'pi_1',
						amount_captured: 4900,
						amount_refunded: 4900,
					},
				},
			}),
		});
		const v = await post(h.app, '/v1/validate', { license_key: key, instance_id: instanceId });
		expect(v.body.valid).toBe(false);
		expect((v.body.license as { status: string }).status).toBe('disabled');
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'x' })).status,
		).toBe(403);
		expect(
			(
				await post(h.app, '/v1/activate', {
					license_key: 'CLEM-Z9Y8-X7W6-V5T4-S3R2',
					instance_name: 'x',
				})
			).status,
		).toBe(404);
	});
});

describe('E2E: trial lifecycle', () => {
	it('valid before expiry, disabled after (offline SDK follows the signal)', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 't@x.io',
			kind: 'trial',
			trial_days: 7,
		});
		const cb = sdk('clementine');
		const { instance } = await cb.activate(key, { name: 'Mac' });
		expect((await cb.verify(key, { instanceId: instance.id })).valid).toBe(true);
		h.clock.advance(8 * 86_400_000);
		const after = await cb.verify(key, { instanceId: instance.id });
		expect(after.valid).toBe(false);
		expect(after.license?.status).toBe('disabled');
	});
});

describe('E2E: floating app', () => {
	it('leases to the limit, heartbeat holds, crashed client frees a seat', async () => {
		await createProduct(h.app, {
			slug: 'hexis',
			name: 'Hexis',
			key_prefix: 'HEX',
			email_from: 'k@hexis.app',
			activation_limit: 2,
			activation_model: 'floating',
			floating_lease_minutes: 30,
		});
		const key = await issueKey(h.app, { product: 'hexis', email: 'b@x.io', kind: 'subscription' });
		const a = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'a' });
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'b' });
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'c' })).status,
		).toBe(409);
		// 'a' heartbeats and survives; 'b' crashes (no heartbeat) and its lease lapses.
		h.clock.advance(29 * 60_000);
		await post(h.app, '/v1/heartbeat', {
			license_key: key,
			instance_id: (a.body.instance as { id: string }).id,
		});
		h.clock.advance(5 * 60_000);
		expect(
			(await post(h.app, '/v1/activate', { license_key: key, instance_name: 'c' })).status,
		).toBe(200);
	});
});

describe('E2E: metered app', () => {
	it('increments to quota, 429 at the limit, resets after the period', async () => {
		await defineMetric(h.app, 'clementine', {
			key: 'api_calls',
			display_name: 'API',
			default_limit: 5,
			reset_period: 'daily',
		});
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'm@x.io',
			kind: 'subscription',
		});
		// Metering is bound to a live seat (§9), so the app activates before counting.
		const act = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'e2e app' });
		const instanceId = (act.body.instance as { id: string }).id;
		for (let i = 0; i < 5; i++) {
			expect(
				(
					await post(h.app, '/v1/usage/increment', {
						license_key: key,
						instance_id: instanceId,
						metric: 'api_calls',
						delta: 1,
					})
				).status,
			).toBe(200);
		}
		expect(
			(
				await post(h.app, '/v1/usage/increment', {
					license_key: key,
					instance_id: instanceId,
					metric: 'api_calls',
					delta: 1,
				})
			).status,
		).toBe(429);
		h.clock.advance(25 * 3_600_000);
		expect(
			(
				await post(h.app, '/v1/usage/increment', {
					license_key: key,
					instance_id: instanceId,
					metric: 'api_calls',
					delta: 1,
				})
			).status,
		).toBe(200);
	});
});

describe('E2E: Stripe lifetime purchase lifecycle (gateway faked at the seam)', () => {
	it('checkout -> email -> SDK activates + verifies offline -> refund -> definitive lockout', async () => {
		h.deps.config.stripe = { secretKey: 'sk', webhookSecret: 'wh' };
		h.deps.stripe = fakeStripeGateway();

		// 1. The customer buys: Stripe delivers checkout.session.completed (paid).
		await stripeWebhook('evt_buy', 'checkout.session.completed', {
			id: 'cs_life',
			mode: 'payment',
			payment_status: 'paid',
			payment_intent: 'pi_life',
			customer_email: 'desktop@example.com',
			metadata: { product: 'clementine' },
		});

		// 2. The key email went out; the key inside it is the real credential.
		expect(h.email.sent).toHaveLength(1);
		const emailedKey = h.email.sent[0]?.html.match(/CLEM(?:-[A-Z0-9]{4}){4}/)?.[0];
		expect(emailedKey).toBeTruthy();

		// 3. A real SDK app activates and verifies with the emailed key.
		const cb = sdk('clementine');
		const { instance } = await cb.activate(emailedKey as string, { name: 'Buyer Mac' });
		const online = await cb.verify(emailedKey as string, { instanceId: instance.id });
		expect(online.valid).toBe(true);
		expect(await cb.verifyOffline()).toBe(true);

		// 4. Full refund: the license is revoked and the SDK sees the definitive signal.
		await stripeWebhook('evt_refund', 'charge.refunded', {
			id: 'ch_life',
			payment_intent: 'pi_life',
			amount_captured: 4900,
			amount_refunded: 4900,
		});
		const after = await cb.verify(emailedKey as string, { instanceId: instance.id });
		expect(after.valid).toBe(false);
		expect(after.license?.status).toBe('disabled');
		expect(after.inconclusive).toBe(false);
		// The definitive disabled signal cleared the cached token: offline no longer unlocks.
		expect(await cb.verifyOffline()).toBe(false);
	});
});

describe('E2E: Stripe yearly subscription lifecycle (gateway faked at the seam)', () => {
	it('subscribe -> renewal advances expiry -> lapse disables', async () => {
		const firstPeriodEnd = '2027-07-17T00:00:00.000Z';
		h.deps.config.stripe = { secretKey: 'sk', webhookSecret: 'wh' };
		h.deps.stripe = fakeStripeGateway({ sub_year: firstPeriodEnd });

		await stripeWebhook('evt_sub', 'checkout.session.completed', {
			id: 'cs_year',
			mode: 'subscription',
			payment_status: 'paid',
			subscription: 'sub_year',
			customer_email: 'yearly@example.com',
			metadata: { product: 'clementine' },
		});
		let keys = await adminKeys('yearly@example.com');
		expect(keys[0]?.kind).toBe('subscription');
		expect(keys[0]?.expires_at).toBe(firstPeriodEnd);

		// A year later Stripe renews: subscription.updated advances the renewal date.
		const nextPeriodEnd = '2028-07-17T00:00:00.000Z';
		await stripeWebhook('evt_renew', 'customer.subscription.updated', {
			id: 'sub_year',
			status: 'active',
			items: {
				data: [{ current_period_end: Math.floor(new Date(nextPeriodEnd).getTime() / 1000) }],
			},
		});
		keys = await adminKeys('yearly@example.com');
		expect(keys[0]?.expires_at).toBe(nextPeriodEnd);
		expect(keys[0]?.status).toBe('active');

		// The customer cancels; at period end Stripe deletes the subscription: lapse.
		await stripeWebhook('evt_lapse', 'customer.subscription.deleted', {
			id: 'sub_year',
			status: 'canceled',
		});
		keys = await adminKeys('yearly@example.com');
		expect(keys[0]?.status).toBe('disabled');
		expect(keys[0]?.disabled_reason).toBe('subscription_canceled');
	});

	it('success page wins the race: lookup ensures the key before the webhook lands', async () => {
		h.deps.config.stripe = { secretKey: 'sk', webhookSecret: 'wh' };
		h.deps.stripe = fakeStripeGateway(
			{},
			{},
			{
				sessions: {
					cs_race2: {
						id: 'cs_race2',
						mode: 'payment',
						payment_status: 'paid',
						payment_intent: 'pi_race2',
						customer_email: 'racer@example.com',
						metadata: { product: 'clementine' },
					},
				},
			},
		);
		// The buyer hits the success page before Stripe delivers the webhook.
		const lookup = await h.app.request('/v1/purchase/session/cs_race2', {
			headers: h.adminHeaders,
		});
		expect(lookup.status).toBe(200);
		expect(((await lookup.json()) as { license: { key: string } }).license.key).toMatch(/^CLEM-/);
		// The webhook then lands: same idempotent path, still exactly one key.
		await stripeWebhook('evt_race2', 'checkout.session.completed', {
			id: 'cs_race2',
			mode: 'payment',
			payment_status: 'paid',
			payment_intent: 'pi_race2',
			customer_email: 'racer@example.com',
			metadata: { product: 'clementine' },
		});
		expect(await adminKeys('racer@example.com')).toHaveLength(1);
	});
});

async function stripeWebhook(eventId: string, type: string, object: Record<string, unknown>) {
	const res = await h.app.request('/v1/stripe/webhook', {
		method: 'POST',
		headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
		body: JSON.stringify({ id: eventId, type, data: { object } }),
	});
	expect(res.status).toBe(200);
}

async function adminKeys(email: string) {
	const res = await h.app.request(
		`/admin/products/clementine/keys?email=${encodeURIComponent(email)}`,
		{ headers: h.adminHeaders },
	);
	return ((await res.json()) as { keys: Array<Record<string, unknown>> }).keys;
}

describe('E2E: Lemon Squeezy client via alias routes', () => {
	it('an LS-shaped client activates/validates/deactivates through /v1/licenses/*', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'ls@x.io',
			kind: 'subscription',
		});
		const activate = await post(h.app, '/v1/licenses/activate', {
			license_key: key,
			instance_name: 'Mac',
		});
		expect(activate.body.activated).toBe(true);
		const instanceId = (activate.body.instance as { id: string }).id;
		const validate = await post(h.app, '/v1/licenses/validate', {
			license_key: key,
			instance_id: instanceId,
		});
		expect(validate.body.valid).toBe(true);
		expect((validate.body.license_key as { activation_usage: number }).activation_usage).toBe(1);
		const deactivate = await post(h.app, '/v1/licenses/deactivate', {
			license_key: key,
			instance_id: instanceId,
		});
		expect(deactivate.body.deactivated).toBe(true);
	});
});
