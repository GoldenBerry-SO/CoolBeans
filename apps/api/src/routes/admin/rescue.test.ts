// ABOUTME: The missed-sale rescue (pricing-UX plan phase 3) — a paid checkout that matched no
// ABOUTME: mapping can be fulfilled after the fact through the same idempotent issuance path.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, seedGrant } from '../../test/seed.js';

let h: TestHarness;

const UNMAPPED_PRICE = 'price_clem_year';
const CHECKOUT = 'cs_missed_1';

function checkoutEvent() {
	return {
		id: 'evt_missed_1',
		type: 'checkout.session.completed',
		data: { object: session() },
	};
}

function session() {
	return {
		id: CHECKOUT,
		mode: 'subscription',
		payment_status: 'paid',
		customer_email: 'missed@example.com',
		payment_intent: 'pi_missed_1',
		subscription: 'sub_missed_1',
		amount_total: 4900,
		currency: 'eur',
	};
}

async function webhook(event: unknown) {
	return h.app.request('/v1/stripe/webhook', {
		method: 'POST',
		headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
		body: JSON.stringify(event),
	});
}

async function rescue(checkoutId: string) {
	const res = await h.app.request('/admin/rescue/checkout', {
		method: 'POST',
		headers: h.adminHeaders,
		body: JSON.stringify({ checkout_id: checkoutId }),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function unfulfilledList() {
	const res = await h.app.request('/admin/rescue/unfulfilled', { headers: h.adminHeaders });
	return (
		(await res.json()) as {
			unfulfilled: Array<{ checkout_id: string; email: string | null; fulfilled: boolean }>;
		}
	).unfulfilled;
}

beforeEach(async () => {
	h = await makeHarness();
	h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: 'whsec_test' };
	h.deps.stripe = fakeStripeGateway(
		{ sub_missed_1: '2027-08-04T00:00:00.000Z' },
		{ [CHECKOUT]: [UNMAPPED_PRICE] },
		{
			prices: { [UNMAPPED_PRICE]: { recurring: true, interval: 'year' } },
			sessions: { [CHECKOUT]: session() },
		},
	);
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clem.test',
	});
	// The missed sale: paid checkout, price mapped to nothing. Money taken, no key.
	const res = await webhook(checkoutEvent());
	expect(res.status).toBe(200);
	expect(h.email.sent).toHaveLength(0);
});

describe('the unfulfilled list', () => {
	it('shows the missed sale with what is known about the buyer', async () => {
		const rows = await unfulfilledList();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			checkout_id: CHECKOUT,
			email: 'missed@example.com',
			fulfilled: false,
		});
	});
});

describe('POST /admin/rescue/checkout', () => {
	it('refuses while no mapping covers the checkout, pointing at mapping first', async () => {
		const r = await rescue(CHECKOUT);
		expect(r.status).toBe(400);
		expect(JSON.stringify(r.body)).toMatch(/map/i);
		expect(h.email.sent).toHaveLength(0);
	});

	it('fulfills the sale once the price is mapped: key issued, email sent, list settles', async () => {
		await seedGrant(h.deps, {
			productId: 1,
			priceId: UNMAPPED_PRICE,
			kind: 'subscription',
			plan: 'Yearly',
		});
		const r = await rescue(CHECKOUT);
		expect(r.status, JSON.stringify(r.body)).toBe(200);
		const license = r.body.license as { key: string; kind: string };
		expect(license.kind).toBe('subscription');
		expect(h.email.sent).toHaveLength(1);
		expect(h.email.sent[0]?.to).toBe('missed@example.com');

		const rows = await unfulfilledList();
		expect(rows[0]?.fulfilled).toBe(true);
	});

	it('is idempotent: a second rescue returns the same licence and sends nothing new', async () => {
		await seedGrant(h.deps, { productId: 1, priceId: UNMAPPED_PRICE, kind: 'subscription' });
		const first = await rescue(CHECKOUT);
		const second = await rescue(CHECKOUT);
		expect(second.status).toBe(200);
		expect((second.body.license as { key: string }).key).toBe(
			(first.body.license as { key: string }).key,
		);
		expect(h.email.sent).toHaveLength(1);
	});

	it('404s a checkout Stripe does not have on the connected account', async () => {
		const r = await rescue('cs_never_existed');
		expect(r.status).toBe(404);
	});
});
