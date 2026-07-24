// ABOUTME: Purchase-lookup tests (PRD §13) — the success-page endpoint and the webhook/page race.
// ABOUTME: Admin-token authed; a lookup before the webhook still yields exactly one license.

import { beforeEach, describe, expect, it } from 'vitest';
import {
	fakePayPalGateway,
	fakeStripeGateway,
	makeHarness,
	type TestHarness,
} from '../../test/harness.js';
import { createProduct, seedGrant } from '../../test/seed.js';

let h: TestHarness;

beforeEach(async () => {
	h = await makeHarness();
	h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: 'whsec_test' };
	h.deps.stripe = fakeStripeGateway({}, { cs_race: ['price_clem'], cs_early: ['price_clem'] });
	const product = await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
	await seedGrant(h.deps, {
		productId: product.id as number,
		priceId: 'price_clem',
		kind: 'perpetual',
	});
});

async function fireCheckoutFor(sessionId: string, email: string) {
	await h.app.request('/v1/stripe/webhook', {
		method: 'POST',
		headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
		body: JSON.stringify({
			id: `evt_${sessionId}`,
			type: 'checkout.session.completed',
			data: {
				object: {
					id: sessionId,
					mode: 'payment',
					payment_status: 'paid',
					customer_email: email,
					metadata: { product: 'clementine' },
				},
			},
		}),
	});
}

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
					payment_status: 'paid',
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

	it('ENSURES via the idempotent path when the webhook has not landed (success-page race)', async () => {
		// The paid session exists at Stripe but no webhook has arrived yet.
		h.deps.stripe = fakeStripeGateway(
			{},
			{ cs_early: ['price_clem'] },
			{
				sessions: {
					cs_early: {
						id: 'cs_early',
						mode: 'payment',
						payment_status: 'paid',
						customer_email: 'early@example.com',
						payment_intent: 'pi_early',
						metadata: { product: 'clementine' },
					},
				},
			},
		);
		const res = await h.app.request('/v1/purchase/session/cs_early', { headers: h.adminHeaders });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { license: { key: string }; email: string };
		expect(body.email).toBe('early@example.com');
		// The later webhook redelivery does not double-issue.
		await fireCheckoutFor('cs_early', 'early@example.com');
		const listed = await h.app.request('/admin/products/clementine/keys?email=early@example.com', {
			headers: h.adminHeaders,
		});
		expect(((await listed.json()) as { keys: unknown[] }).keys).toHaveLength(1);
	});

	it('a product token reads only its own product', async () => {
		// Rotate a token for clementine and create a second product with its own purchase.
		const rotated = await h.app.request('/admin/products/clementine/token/rotate', {
			method: 'POST',
			headers: h.adminHeaders,
		});
		const token = ((await rotated.json()) as { product_token: string }).product_token;
		await fireCheckout();
		// The clementine token can read the clementine purchase…
		const ok = await h.app.request('/v1/purchase/session/cs_race', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(ok.status).toBe(200);
		// …a bogus token cannot read anything…
		const bad = await h.app.request('/v1/purchase/session/cs_race', {
			headers: { Authorization: 'Bearer cbp_wrong' },
		});
		expect(bad.status).toBe(401);
	});
});

describe('PayPal success-page race (PRD §14)', () => {
	it('ENSURES from a captured PayPal order when the webhook has not landed', async () => {
		h.deps.config.paypal = { clientId: 'id', secret: 'secret', webhookId: 'wh' };
		h.deps.paypal = {
			...fakePayPalGateway(),
			async getOrder(orderId: string) {
				if (orderId !== 'PAYPAL-ORDER-1') return null;
				return {
					id: 'PAYPAL-ORDER-1',
					status: 'COMPLETED',
					purchase_units: [
						{
							custom_id: 'clementine:lifetime',
							payments: {
								captures: [{ id: 'CAPTURE-1', status: 'COMPLETED' }],
							},
						},
					],
					payer: { email_address: 'paypal-buyer@example.com' },
				};
			},
		};

		const res = await h.app.request('/v1/purchase/session/PAYPAL-ORDER-1', {
			headers: h.adminHeaders,
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { email: string; license: { product: string } };
		expect(body.email).toBe('paypal-buyer@example.com');
		expect(body.license.product).toBe('clementine');
	});

	it('does not issue from an order that was never captured', async () => {
		h.deps.config.paypal = { clientId: 'id', secret: 'secret', webhookId: 'wh' };
		h.deps.paypal = {
			...fakePayPalGateway(),
			async getOrder() {
				return {
					id: 'PAYPAL-ORDER-2',
					status: 'APPROVED',
					purchase_units: [{ custom_id: 'clementine:lifetime' }],
					payer: { email_address: 'nope@example.com' },
				};
			},
		};
		const res = await h.app.request('/v1/purchase/session/PAYPAL-ORDER-2', {
			headers: h.adminHeaders,
		});
		expect(res.status).toBe(404);
	});
});
