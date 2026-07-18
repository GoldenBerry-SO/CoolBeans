// ABOUTME: Regression tests for the P1s Codex found in the batch work.
// ABOUTME: Each one is a way the system silently loses money, access, or protection.

import { purchases } from '@coolbeans/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../test/harness.js';
import { createProduct, issueKey, post } from '../test/seed.js';
import { drainOutbox } from './outbox.js';
import { claimEvent } from './payments.js';

let h: TestHarness;

beforeEach(async () => {
	h = makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
});

describe('a live claim must not swallow the provider retry', () => {
	it('answers a retryable failure while another worker holds the claim', async () => {
		h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: 'whsec_test' };
		h.deps.stripe = fakeStripeGateway({}, { cs_x: ['price_x'] });

		// A worker claimed this event and then crashed: the row stays 'processing'.
		expect(claimEvent(h.deps, { id: 'evt_wedged', provider: 'stripe', type: 'x' })).toBe(true);

		const res = await h.app.request('/v1/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 'evt_wedged',
				type: 'checkout.session.completed',
				data: { object: {} },
			}),
		});
		// A 200 here tells Stripe to stop retrying, and the work is lost forever.
		expect(res.status).toBeGreaterThanOrEqual(500);
	});

	it('still acknowledges an event that genuinely finished', async () => {
		h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: 'whsec_test' };
		h.deps.stripe = fakeStripeGateway({}, { cs_done: ['price_none'] });
		const event = {
			id: 'evt_done',
			type: 'customer.subscription.updated',
			data: { object: { id: 'sub_1', status: 'active' } },
		};
		const first = await h.app.request('/v1/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
			body: JSON.stringify(event),
		});
		expect(first.status).toBe(200);
		const redelivery = await h.app.request('/v1/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
			body: JSON.stringify(event),
		});
		expect(redelivery.status).toBe(200);
	});
});

describe('archiving a product must not lose a paid checkout', () => {
	it('still issues for a payment that arrives after archiving, and says so loudly', async () => {
		h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: 'whsec_test' };
		h.deps.stripe = fakeStripeGateway({}, { cs_late: ['price_late'] });
		await h.app.request('/admin/products/clementine', {
			method: 'PATCH',
			headers: h.adminHeaders,
			body: JSON.stringify({ stripe_price_lifetime: 'price_late' }),
		});
		await h.app.request('/admin/products/clementine', {
			method: 'DELETE',
			headers: h.adminHeaders,
		});

		await h.app.request('/v1/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 'evt_late',
				type: 'checkout.session.completed',
				data: {
					object: {
						id: 'cs_late',
						mode: 'payment',
						payment_status: 'paid',
						customer_email: 'paid@example.com',
					},
				},
			}),
		});

		// Taking the money and issuing nothing is the worst outcome, so the key is issued.
		const keys = await h.app.request('/admin/products/clementine/keys', {
			headers: h.adminHeaders,
		});
		expect(((await keys.json()) as { keys: unknown[] }).keys).toHaveLength(1);

		// But the operator has to be able to see that it happened.
		const audit = await h.app.request('/admin/audit', { headers: h.adminHeaders });
		const actions = ((await audit.json()) as { audit: { action: string }[] }).audit.map(
			(a) => a.action,
		);
		expect(actions).toContain('license.issued_for_archived_product');
	});
});

describe('manual issuance durability', () => {
	it('rolls back the purchase if the license insert fails', async () => {
		h.deps.db.$client.exec(`
			CREATE TRIGGER reject_license_insert
			BEFORE INSERT ON licenses
			BEGIN
				SELECT RAISE(ABORT, 'simulated license failure');
			END
		`);
		const res = await h.app.request('/admin/keys', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				product: 'clementine',
				email: 'buyer@example.com',
				tier: 'lifetime',
			}),
		});
		expect(res.status).toBe(500);
		expect(h.deps.db.select().from(purchases).all()).toHaveLength(0);
	});

	it('does not deliver a queued key after the license is disabled', async () => {
		h.email.failNext = true;
		const issued = await h.app.request('/admin/keys', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				product: 'clementine',
				email: 'buyer@example.com',
				tier: 'lifetime',
			}),
		});
		const body = (await issued.json()) as { key: string };
		expect(issued.status).toBe(200);

		await h.app.request(`/admin/keys/${encodeURIComponent(body.key)}/disable`, {
			method: 'POST',
			headers: h.adminHeaders,
			body: '{}',
		});
		h.clock.advance(61_000);
		expect(await drainOutbox(h.deps)).toBe(1);
		expect(h.email.sent).toHaveLength(0);
	});
});

describe('the per-key throttle covers every public lookup', () => {
	it('cannot be bypassed by probing through validate instead of activate', async () => {
		const target = 'CLEM-AAAA-BBBB-CCCC-DDDD';
		let last = 0;
		for (let i = 0; i < 12; i++) {
			const r = await post(h.app, '/v1/validate', {
				license_key: target,
				instance_id: 'probe',
			});
			last = r.status;
		}
		expect(last).toBe(429);
	});

	it('cannot be bypassed through the usage endpoint either', async () => {
		const target = 'CLEM-EEEE-FFFF-GGGG-HHHH';
		let last = 0;
		for (let i = 0; i < 12; i++) {
			const r = await post(h.app, '/v1/usage/increment', {
				license_key: target,
				instance_id: 'probe',
				metric: 'api_calls',
				delta: 1,
			});
			last = r.status;
		}
		expect(last).toBe(429);
	});

	it('a real key still works while another key is locked out', async () => {
		const good = await issueKey(h.app, {
			product: 'clementine',
			email: 'buyer@example.com',
			tier: 'lifetime',
		});
		for (let i = 0; i < 12; i++) {
			await post(h.app, '/v1/validate', {
				license_key: 'CLEM-JJJJ-KKKK-MMMM-NNNN',
				instance_id: 'probe',
			});
		}
		const res = await post(h.app, '/v1/activate', {
			license_key: good,
			instance_name: 'Real device',
		});
		expect(res.status).toBe(200);
	});
});
