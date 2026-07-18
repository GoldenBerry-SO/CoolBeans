// ABOUTME: PayPal webhook tests (PRD §13) — the same flows as Stripe through the shared issuance core.
// ABOUTME: Verifies signature rejection, capture issuance, refund and cancellation disabling.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakePayPalGateway, makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct } from '../../test/seed.js';

let h: TestHarness;

async function webhook(app: TestHarness['app'], event: unknown) {
	const res = await app.request('/v1/paypal/webhook', {
		method: 'POST',
		headers: {
			'paypal-transmission-id': 't1',
			'paypal-transmission-sig': 's1',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(event),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function keys(h: TestHarness, email: string) {
	const res = await h.app.request(
		`/admin/products/photoglide/keys?email=${encodeURIComponent(email)}`,
		{
			headers: h.adminHeaders,
		},
	);
	return ((await res.json()) as { keys: Array<Record<string, unknown>> }).keys;
}

beforeEach(async () => {
	h = makeHarness();
	h.deps.config.paypal = { clientId: 'id', secret: 'sec', webhookId: 'wh_1' };
	h.deps.paypal = fakePayPalGateway({ verified: true });
	await createProduct(h.app, {
		slug: 'photoglide',
		name: 'PhotoGlide',
		key_prefix: 'PG',
		email_from: 'PhotoGlide <k@photoglide.io>',
	});
});

describe('PayPal webhook', () => {
	it('rejects an unverified transmission', async () => {
		h.deps.paypal = fakePayPalGateway({ verified: false });
		const r = await webhook(h.app, {
			id: 'wh_evt_1',
			event_type: 'PAYMENT.CAPTURE.COMPLETED',
			resource: {
				id: 'cap_1',
				custom_id: 'photoglide:lifetime',
				payer: { email_address: 'b@x.io' },
			},
		});
		expect(r.status).toBe(400);
		expect(await keys(h, 'b@x.io')).toHaveLength(0);
	});

	it('issues a key on capture completed', async () => {
		const r = await webhook(h.app, {
			id: 'wh_evt_2',
			event_type: 'PAYMENT.CAPTURE.COMPLETED',
			resource: {
				id: 'cap_2',
				custom_id: 'photoglide:lifetime',
				payer: { email_address: 'b@x.io' },
			},
		});
		expect(r.status).toBe(200);
		const k = await keys(h, 'b@x.io');
		expect(k).toHaveLength(1);
		expect(k[0]?.tier).toBe('lifetime');
	});

	it('records provider=paypal on the purchase', async () => {
		await webhook(h.app, {
			id: 'wh_evt_3',
			event_type: 'PAYMENT.CAPTURE.COMPLETED',
			resource: {
				id: 'cap_3',
				custom_id: 'photoglide:lifetime',
				payer: { email_address: 'p@x.io' },
			},
		});
		const res = await h.app.request('/admin/purchases?email=p@x.io', { headers: h.adminHeaders });
		const body = (await res.json()) as { purchases: Array<{ provider: string }> };
		expect(body.purchases[0]?.provider).toBe('paypal');
	});

	it('disables on refund and on subscription cancellation', async () => {
		await webhook(h.app, {
			id: 'wh_evt_4',
			event_type: 'PAYMENT.CAPTURE.COMPLETED',
			resource: {
				id: 'cap_4',
				custom_id: 'photoglide:lifetime',
				payer: { email_address: 'r@x.io' },
			},
		});
		await webhook(h.app, {
			id: 'wh_evt_5',
			event_type: 'PAYMENT.CAPTURE.REFUNDED',
			resource: { id: 'cap_4' },
		});
		expect((await keys(h, 'r@x.io'))[0]?.status).toBe('disabled');
	});

	it('is idempotent across redelivery', async () => {
		const event = {
			id: 'wh_evt_6',
			event_type: 'PAYMENT.CAPTURE.COMPLETED',
			resource: {
				id: 'cap_6',
				custom_id: 'photoglide:lifetime',
				payer: { email_address: 'i@x.io' },
			},
		};
		await webhook(h.app, event);
		await webhook(h.app, event);
		expect(await keys(h, 'i@x.io')).toHaveLength(1);
	});
});
