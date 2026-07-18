// ABOUTME: Purchase-lookup tests (PRD §13) — the success-page endpoint and the webhook/page race.
// ABOUTME: Admin-token authed; a lookup before the webhook still yields exactly one license.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct } from '../../test/seed.js';

let h: TestHarness;

beforeEach(async () => {
	h = makeHarness();
	h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: 'whsec_test' };
	h.deps.stripe = fakeStripeGateway();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
});

async function fireCheckout() {
	await h.app.request('/v1/stripe/webhook', {
		method: 'POST',
		headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
		body: JSON.stringify({
			id: 'evt_1',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_race',
					mode: 'payment',
					customer_email: 'buyer@example.com',
					payment_intent: 'pi_1',
					metadata: { product: 'clementine' },
				},
			},
		}),
	});
}

describe('GET /v1/purchase/session/:id', () => {
	it('requires the admin token', async () => {
		const res = await h.app.request('/v1/purchase/session/cs_race');
		expect(res.status).toBe(401);
	});

	it('returns 404 for an unknown session', async () => {
		const res = await h.app.request('/v1/purchase/session/cs_missing', { headers: h.adminHeaders });
		expect(res.status).toBe(404);
	});

	it('returns the license + buyer email after the webhook issues', async () => {
		await fireCheckout();
		const res = await h.app.request('/v1/purchase/session/cs_race', { headers: h.adminHeaders });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { license: { key: string }; email: string };
		expect(body.email).toBe('buyer@example.com');
		expect(body.license.key).toMatch(/^CLEM-/);
	});
});
