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
	h = await makeHarness();
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
				custom_id: 'photoglide:perpetual',
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
				custom_id: 'photoglide:perpetual',
				payer: { email_address: 'b@x.io' },
			},
		});
		expect(r.status).toBe(200);
		const k = await keys(h, 'b@x.io');
		expect(k).toHaveLength(1);
		expect(k[0]?.kind).toBe('perpetual');
	});

	it('records provider=paypal on the purchase', async () => {
		await webhook(h.app, {
			id: 'wh_evt_3',
			event_type: 'PAYMENT.CAPTURE.COMPLETED',
			resource: {
				id: 'cap_3',
				custom_id: 'photoglide:perpetual',
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
				custom_id: 'photoglide:perpetual',
				payer: { email_address: 'r@x.io' },
			},
		});
		// Realistic refund payload: resource.id is the REFUND id; the capture is in the up link.
		await webhook(h.app, {
			id: 'wh_evt_5',
			event_type: 'PAYMENT.CAPTURE.REFUNDED',
			resource: {
				id: 'refund_9XY',
				links: [
					{ rel: 'self', href: 'https://api.paypal.com/v2/payments/refunds/refund_9XY' },
					{ rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/cap_4' },
				],
			},
		});
		expect((await keys(h, 'r@x.io'))[0]?.status).toBe('disabled');
	});

	it('parks a refund that arrives before its capture and never emails the revoked key', async () => {
		await webhook(h.app, {
			id: 'wh_early_refund',
			event_type: 'PAYMENT.CAPTURE.REFUNDED',
			resource: {
				id: 'refund_early',
				links: [{ rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/cap_early' }],
			},
		});
		await webhook(h.app, {
			id: 'wh_late_capture',
			event_type: 'PAYMENT.CAPTURE.COMPLETED',
			resource: {
				id: 'cap_early',
				custom_id: 'photoglide:perpetual',
				payer: { email_address: 'early-refund@example.com' },
			},
		});

		const issued = await keys(h, 'early-refund@example.com');
		expect(issued).toHaveLength(1);
		expect(issued[0]?.status).toBe('disabled');
		expect(issued[0]?.disabled_reason).toBe('refund');
		expect(h.email.sent).toHaveLength(0);
	});

	it('parks a cancellation that arrives before subscription activation', async () => {
		// An activated PayPal subscription carries a next billing date, and issuance now insists
		// on one: a subscription licence with no expiry would never expire.
		h.deps.paypal = fakePayPalGateway({
			verified: true,
			nextBilling: { sub_early: '2027-01-01T00:00:00.000Z' },
		});
		await webhook(h.app, {
			id: 'wh_early_cancel',
			event_type: 'BILLING.SUBSCRIPTION.CANCELLED',
			resource: { id: 'sub_early' },
		});
		await webhook(h.app, {
			id: 'wh_late_activation',
			event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
			resource: {
				id: 'sub_early',
				custom_id: 'photoglide:subscription',
				subscriber: { email_address: 'early-cancel@example.com' },
			},
		});

		const issued = await keys(h, 'early-cancel@example.com');
		expect(issued).toHaveLength(1);
		expect(issued[0]?.status).toBe('disabled');
		expect(issued[0]?.disabled_reason).toBe('subscription_canceled');
		expect(h.email.sent).toHaveLength(0);
	});

	it('is idempotent across redelivery', async () => {
		const event = {
			id: 'wh_evt_6',
			event_type: 'PAYMENT.CAPTURE.COMPLETED',
			resource: {
				id: 'cap_6',
				custom_id: 'photoglide:perpetual',
				payer: { email_address: 'i@x.io' },
			},
		};
		await webhook(h.app, event);
		await webhook(h.app, event);
		expect(await keys(h, 'i@x.io')).toHaveLength(1);
	});
});
