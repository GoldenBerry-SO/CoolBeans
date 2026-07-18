// ABOUTME: Stripe webhook tests (PRD §13) — issuance, lapse, refund, dispute, idempotency, email retry.
// ABOUTME: Uses a fake gateway ('valid' signature) so no network is touched; asserts the validated edge cases.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct } from '../../test/seed.js';

let h: TestHarness;
const PERIOD_END = '2027-07-17T00:00:00.000Z';

async function webhook(app: TestHarness['app'], event: unknown, signature = 'valid') {
	const res = await app.request('/v1/stripe/webhook', {
		method: 'POST',
		headers: { 'stripe-signature': signature, 'Content-Type': 'application/json' },
		body: JSON.stringify(event),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function keysForEmail(h: TestHarness, email: string) {
	const res = await h.app.request(
		`/admin/products/clementine/keys?email=${encodeURIComponent(email)}`,
		{
			headers: h.adminHeaders,
		},
	);
	return ((await res.json()) as { keys: Array<Record<string, unknown>> }).keys;
}

beforeEach(async () => {
	h = makeHarness();
	h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: 'whsec_test' };
	h.deps.stripe = fakeStripeGateway({ sub_1: PERIOD_END });
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'Clementine <r@clementine.email>',
	});
});

function checkout(overrides: Record<string, unknown> = {}) {
	return {
		id: 'evt_1',
		type: 'checkout.session.completed',
		data: {
			object: {
				id: 'cs_1',
				mode: 'payment',
				payment_status: 'paid',
				customer_email: 'buyer@example.com',
				payment_intent: 'pi_1',
				metadata: { product: 'clementine' },
				...overrides,
			},
		},
	};
}

describe('Stripe webhook', () => {
	it('rejects an unverified signature before doing anything', async () => {
		const r = await webhook(h.app, checkout(), 'bogus');
		expect(r.status).toBe(400);
		expect(r.body.error).toBe('invalid_signature');
		expect(await keysForEmail(h, 'buyer@example.com')).toHaveLength(0);
	});

	it('issues a lifetime key on a one-time checkout', async () => {
		const r = await webhook(h.app, checkout());
		expect(r.status).toBe(200);
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys).toHaveLength(1);
		expect(keys[0]?.tier).toBe('lifetime');
		expect(keys[0]?.expires_at).toBeNull();
		expect(h.email.sent).toHaveLength(1);
	});

	it('issues a yearly key with expires_at from the subscription (Basil item period end)', async () => {
		await webhook(h.app, checkout({ id: 'cs_2', mode: 'subscription', subscription: 'sub_1' }));
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.tier).toBe('yearly');
		expect(keys[0]?.expires_at).toBe(PERIOD_END);
	});

	it('is idempotent across redelivery of the same event and checkout id', async () => {
		await webhook(h.app, checkout());
		await webhook(h.app, checkout());
		await webhook(h.app, { ...checkout(), id: 'evt_1b' }); // same checkout id, new event id
		expect(await keysForEmail(h, 'buyer@example.com')).toHaveLength(1);
	});

	it('disables the key on a full refund', async () => {
		await webhook(h.app, checkout());
		await webhook(h.app, {
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
		});
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status).toBe('disabled');
		expect(keys[0]?.disabled_reason).toBe('refund');
	});

	it('keeps the key active on a partial refund', async () => {
		await webhook(h.app, checkout());
		await webhook(h.app, {
			id: 'evt_partial',
			type: 'charge.refunded',
			data: {
				object: {
					id: 'ch_1',
					payment_intent: 'pi_1',
					amount_captured: 4900,
					amount_refunded: 1000,
				},
			},
		});
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status).toBe('active');
	});

	it('disables a yearly key on subscription.deleted (lapse enforcement)', async () => {
		await webhook(h.app, checkout({ id: 'cs_2', mode: 'subscription', subscription: 'sub_1' }));
		await webhook(h.app, {
			id: 'evt_del',
			type: 'customer.subscription.deleted',
			data: { object: { id: 'sub_1', status: 'canceled' } },
		});
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status).toBe('disabled');
		expect(keys[0]?.disabled_reason).toBe('subscription_canceled');
	});

	it('disables on subscription.updated status=unpaid (dunning belt-and-braces)', async () => {
		await webhook(h.app, checkout({ id: 'cs_2', mode: 'subscription', subscription: 'sub_1' }));
		await webhook(h.app, {
			id: 'evt_unpaid',
			type: 'customer.subscription.updated',
			data: { object: { id: 'sub_1', status: 'unpaid' } },
		});
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status).toBe('disabled');
	});

	it('advances expires_at on subscription.updated renewal', async () => {
		await webhook(h.app, checkout({ id: 'cs_2', mode: 'subscription', subscription: 'sub_1' }));
		const next = '2028-07-17T00:00:00.000Z';
		await webhook(h.app, {
			id: 'evt_renew',
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_1',
					status: 'active',
					items: { data: [{ current_period_end: Math.floor(new Date(next).getTime() / 1000) }] },
				},
			},
		});
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.expires_at).toBe(next);
		expect(keys[0]?.status).toBe('active');
	});

	it('disables on a chargeback (dispute created) even without a refund event', async () => {
		await webhook(h.app, checkout());
		await webhook(h.app, {
			id: 'evt_dispute',
			type: 'charge.dispute.created',
			data: { object: { id: 'dp_1', payment_intent: 'pi_1' } },
		});
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status).toBe('disabled');
		expect(keys[0]?.disabled_reason).toBe('chargeback');
	});

	it('resolves the product from the line-item price id when metadata is absent', async () => {
		// Wire the product's price ids (as beans stripe connect would), then send a
		// checkout with no metadata — e.g. a dashboard Payment Link.
		await h.app.request('/admin/products/clementine', {
			method: 'PATCH',
			headers: h.adminHeaders,
			body: JSON.stringify({
				stripe_price_lifetime: 'price_life_1',
				stripe_price_yearly: 'price_year_1',
			}),
		});
		h.deps.stripe = fakeStripeGateway({}, { cs_nometa: ['price_life_1'] });
		const r = await webhook(h.app, {
			id: 'evt_nometa',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_nometa',
					mode: 'payment',
					payment_status: 'paid',
					customer_email: 'link@example.com',
					metadata: {},
				},
			},
		});
		expect(r.status).toBe(200);
		const keys = await keysForEmail(h, 'link@example.com');
		expect(keys).toHaveLength(1);
		expect(keys[0]?.tier).toBe('lifetime');
	});

	it('does NOT issue for an unpaid session; async settle issues later', async () => {
		// SEPA/ACH-style async payment: the session completes before the money settles.
		const r = await webhook(h.app, checkout({ id: 'cs_async', payment_status: 'unpaid' }));
		expect(r.status).toBe(200);
		expect(await keysForEmail(h, 'buyer@example.com')).toHaveLength(0);
		// The settle event re-enters the same path and issues exactly one key.
		await webhook(h.app, {
			...checkout({ id: 'cs_async', payment_status: 'paid' }),
			id: 'evt_async_ok',
			type: 'checkout.session.async_payment_succeeded',
		});
		expect(await keysForEmail(h, 'buyer@example.com')).toHaveLength(1);
	});

	it('disables on a renewal-invoice refund resolved via invoice -> subscription', async () => {
		await webhook(h.app, checkout({ id: 'cs_2', mode: 'subscription', subscription: 'sub_1' }));
		// A renewal charge: unknown payment intent, invoice as a plain string id.
		h.deps.stripe = fakeStripeGateway(
			{ sub_1: PERIOD_END },
			{},
			{ invoiceSubscriptions: { in_renewal_1: 'sub_1' } },
		);
		await webhook(h.app, {
			id: 'evt_renewal_refund',
			type: 'charge.refunded',
			data: {
				object: {
					id: 'ch_renewal',
					payment_intent: 'pi_renewal_unknown',
					invoice: 'in_renewal_1',
					amount_captured: 2900,
					amount_refunded: 2900,
				},
			},
		});
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status).toBe('disabled');
		expect(keys[0]?.disabled_reason).toBe('refund');
	});

	// A disable has to be reversible when the thing that caused it goes away, or we bill
	// people we refuse to serve. Each of these was reproduced against a live server.

	it('restores access when a subscriber pays up after a failed payment', async () => {
		await webhook(h.app, checkout({ id: 'cs_2', mode: 'subscription', subscription: 'sub_1' }));
		await webhook(h.app, {
			id: 'evt_unpaid',
			type: 'customer.subscription.updated',
			data: { object: { id: 'sub_1', status: 'unpaid' } },
		});
		expect((await keysForEmail(h, 'buyer@example.com'))[0]?.status).toBe('disabled');

		// They update their card; Stripe recovers the subscription.
		const next = '2028-07-17T00:00:00.000Z';
		await webhook(h.app, {
			id: 'evt_recovered',
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_1',
					status: 'active',
					items: { data: [{ current_period_end: Math.floor(new Date(next).getTime() / 1000) }] },
				},
			},
		});
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status).toBe('active');
		expect(keys[0]?.disabled_reason).toBeNull();
		expect(keys[0]?.expires_at).toBe(next);
	});

	it('does not resurrect a refunded key just because the subscription reports active', async () => {
		await webhook(h.app, checkout({ id: 'cs_2', mode: 'subscription', subscription: 'sub_1' }));
		await webhook(h.app, {
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
		});
		await webhook(h.app, {
			id: 'evt_still_active',
			type: 'customer.subscription.updated',
			data: { object: { id: 'sub_1', status: 'active' } },
		});
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status).toBe('disabled');
		expect(keys[0]?.disabled_reason).toBe('refund');
	});

	it('restores access when we win the dispute (the money stays with us)', async () => {
		await webhook(h.app, checkout());
		await webhook(h.app, {
			id: 'evt_dispute',
			type: 'charge.dispute.created',
			data: { object: { id: 'dp_1', payment_intent: 'pi_1' } },
		});
		await webhook(h.app, {
			id: 'evt_dispute_won',
			type: 'charge.dispute.closed',
			data: { object: { id: 'dp_1', payment_intent: 'pi_1', status: 'won' } },
		});
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status).toBe('active');
		expect(keys[0]?.disabled_reason).toBeNull();
	});

	it('keeps access revoked when we lose the dispute', async () => {
		await webhook(h.app, checkout());
		await webhook(h.app, {
			id: 'evt_dispute',
			type: 'charge.dispute.created',
			data: { object: { id: 'dp_1', payment_intent: 'pi_1' } },
		});
		await webhook(h.app, {
			id: 'evt_dispute_lost',
			type: 'charge.dispute.closed',
			data: { object: { id: 'dp_1', payment_intent: 'pi_1', status: 'lost' } },
		});
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status).toBe('disabled');
		expect(keys[0]?.disabled_reason).toBe('chargeback');
	});

	it('does not issue an active key when the refund arrived before the purchase', async () => {
		// Stripe does not guarantee delivery order. A refund naming a charge we have not
		// seen yet must not be forgotten, or the checkout behind it issues a free licence.
		await webhook(h.app, {
			id: 'evt_early_refund',
			type: 'charge.refunded',
			data: {
				object: {
					id: 'ch_1',
					payment_intent: 'pi_1',
					amount_captured: 4900,
					amount_refunded: 4900,
				},
			},
		});
		await webhook(h.app, checkout());
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys).toHaveLength(1);
		expect(keys[0]?.status).toBe('disabled');
		expect(keys[0]?.disabled_reason).toBe('refund');
	});

	// Codex found these against the first version of the restore work. Every one of them
	// either hands back access that should stay revoked, or strands a paying customer.

	it('stays disabled when a second cause is still standing', async () => {
		// Chargeback AND cancellation. Winning the dispute clears the chargeback, but the
		// subscription is still gone, so access must not come back.
		await webhook(h.app, checkout({ id: 'cs_2', mode: 'subscription', subscription: 'sub_1' }));
		await webhook(h.app, {
			id: 'evt_dispute',
			type: 'charge.dispute.created',
			data: { object: { id: 'dp_1', payment_intent: 'pi_1' } },
		});
		await webhook(h.app, {
			id: 'evt_cancel',
			type: 'customer.subscription.deleted',
			data: { object: { id: 'sub_1', status: 'canceled' } },
		});
		await webhook(h.app, {
			id: 'evt_won',
			type: 'charge.dispute.closed',
			data: { object: { id: 'dp_1', payment_intent: 'pi_1', status: 'won' } },
		});
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status).toBe('disabled');
	});

	it('does not treat past_due or a dead subscription as recovery', async () => {
		for (const status of ['past_due', 'incomplete_expired', 'paused']) {
			const harness = h;
			await webhook(harness.app, {
				id: `evt_unpaid_${status}`,
				type: 'customer.subscription.updated',
				data: { object: { id: 'sub_1', status: 'unpaid' } },
			});
			await webhook(harness.app, {
				id: `evt_${status}`,
				type: 'customer.subscription.updated',
				data: { object: { id: 'sub_1', status } },
			});
		}
		// Set up a real subscription licence first, then replay the sequence on it.
		await webhook(h.app, checkout({ id: 'cs_2', mode: 'subscription', subscription: 'sub_2' }));
		await webhook(h.app, {
			id: 'evt_lapse_2',
			type: 'customer.subscription.updated',
			data: { object: { id: 'sub_2', status: 'unpaid' } },
		});
		await webhook(h.app, {
			id: 'evt_pastdue_2',
			type: 'customer.subscription.updated',
			data: { object: { id: 'sub_2', status: 'past_due' } },
		});
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status, 'past_due means still not paid').toBe('disabled');
	});

	it('revokes when a cancellation arrives before its checkout', async () => {
		// Same out-of-order problem refunds have. Without parking it, the checkout behind
		// it issues an active yearly key for a subscription that is already dead.
		await webhook(h.app, {
			id: 'evt_early_cancel',
			type: 'customer.subscription.deleted',
			data: { object: { id: 'sub_1', status: 'canceled' } },
		});
		await webhook(h.app, checkout({ id: 'cs_2', mode: 'subscription', subscription: 'sub_1' }));
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys).toHaveLength(1);
		expect(keys[0]?.status).toBe('disabled');
		expect(keys[0]?.disabled_reason).toBe('subscription_canceled');
	});

	it('revokes an early subscription refund the checkout can actually match', async () => {
		// A renewal refund names an invoice payment intent the checkout never mentions.
		// Parking it under that id alone means issuance can never find it.
		h.deps.stripe = fakeStripeGateway(
			{ sub_1: PERIOD_END },
			{},
			{ chargeSubscriptions: { ch_renewal: 'sub_1' } },
		);
		await webhook(h.app, {
			id: 'evt_early_sub_refund',
			type: 'charge.refunded',
			data: {
				object: {
					id: 'ch_renewal',
					payment_intent: 'pi_invoice_unknown',
					amount_captured: 4900,
					amount_refunded: 4900,
				},
			},
		});
		await webhook(h.app, checkout({ id: 'cs_2', mode: 'subscription', subscription: 'sub_1' }));
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status).toBe('disabled');
		expect(keys[0]?.disabled_reason).toBe('refund');
	});

	it('does not strand a customer when the dispute is won before the checkout lands', async () => {
		// dispute.created parks a chargeback; we then win. The parked revocation must not
		// outlive the dispute and disable a licence issued afterwards.
		await webhook(h.app, {
			id: 'evt_dispute_early',
			type: 'charge.dispute.created',
			data: { object: { id: 'dp_1', payment_intent: 'pi_1' } },
		});
		await webhook(h.app, {
			id: 'evt_won_early',
			type: 'charge.dispute.closed',
			data: { object: { id: 'dp_1', payment_intent: 'pi_1', status: 'won' } },
		});
		await webhook(h.app, checkout());
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status, 'we kept the money, so they keep the licence').toBe('active');
	});

	it('still revokes when a dispute is lost before the checkout lands', () => {
		return (async () => {
			await webhook(h.app, {
				id: 'evt_dispute_early',
				type: 'charge.dispute.created',
				data: { object: { id: 'dp_1', payment_intent: 'pi_1' } },
			});
			await webhook(h.app, {
				id: 'evt_lost_early',
				type: 'charge.dispute.closed',
				data: { object: { id: 'dp_1', payment_intent: 'pi_1', status: 'lost' } },
			});
			await webhook(h.app, checkout());
			const keys = await keysForEmail(h, 'buyer@example.com');
			expect(keys[0]?.status).toBe('disabled');
			expect(keys[0]?.disabled_reason).toBe('chargeback');
		})();
	});

	it('keeps a parked refund when a dispute on the same payment is won', async () => {
		// Both park against the same payment intent. Winning the dispute drops the
		// chargeback, but the money was still refunded, so access must not be issued.
		await webhook(h.app, {
			id: 'evt_early_refund_2',
			type: 'charge.refunded',
			data: {
				object: {
					id: 'ch_1',
					payment_intent: 'pi_1',
					amount_captured: 4900,
					amount_refunded: 4900,
				},
			},
		});
		await webhook(h.app, {
			id: 'evt_dispute_2',
			type: 'charge.dispute.created',
			data: { object: { id: 'dp_1', payment_intent: 'pi_1' } },
		});
		await webhook(h.app, {
			id: 'evt_won_2',
			type: 'charge.dispute.closed',
			data: { object: { id: 'dp_1', payment_intent: 'pi_1', status: 'won' } },
		});
		await webhook(h.app, checkout());
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status, 'the refund still stands even though we won the dispute').toBe(
			'disabled',
		);
		expect(keys[0]?.disabled_reason).toBe('refund');
	});

	it('keeps a parked refund when the DISPUTE was parked first and then won', async () => {
		// Order matters. If both causes share one row, the dispute lands first, the refund
		// is swallowed as a duplicate, and winning the dispute deletes the only record —
		// so the checkout behind it issues a working key for money we refunded.
		await webhook(h.app, {
			id: 'evt_dispute_3',
			type: 'charge.dispute.created',
			data: { object: { id: 'dp_1', payment_intent: 'pi_1' } },
		});
		await webhook(h.app, {
			id: 'evt_refund_3',
			type: 'charge.refunded',
			data: {
				object: {
					id: 'ch_1',
					payment_intent: 'pi_1',
					amount_captured: 4900,
					amount_refunded: 4900,
				},
			},
		});
		await webhook(h.app, {
			id: 'evt_won_3',
			type: 'charge.dispute.closed',
			data: { object: { id: 'dp_1', payment_intent: 'pi_1', status: 'won' } },
		});
		await webhook(h.app, checkout());
		const keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys[0]?.status, 'the refund still stands even though we won the dispute').toBe(
			'disabled',
		);
		expect(keys[0]?.disabled_reason).toBe('refund');
	});

	it('flags a checkout that paid for several units but gets one key', async () => {
		// A landing page with adjustable quantity (or quantity: 3) charges three times
		// and still gets exactly one licence. We cannot un-charge them, but leaving no
		// record means nobody ever finds out they were short-changed.
		await h.app.request('/admin/products/clementine', {
			method: 'PATCH',
			headers: h.adminHeaders,
			body: JSON.stringify({ stripe_price_lifetime: 'price_life_1' }),
		});
		h.deps.stripe = fakeStripeGateway({}, { cs_bulk: [{ priceId: 'price_life_1', quantity: 3 }] });
		const r = await webhook(h.app, {
			id: 'evt_bulk',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_bulk',
					mode: 'payment',
					payment_status: 'paid',
					customer_email: 'bulk@example.com',
					amount_total: 14700,
					metadata: {},
				},
			},
		});
		expect(r.status).toBe(200);
		// Issuance still happens: the customer paid and must not be left with nothing.
		expect(await keysForEmail(h, 'bulk@example.com')).toHaveLength(1);

		const audit = await h.app.request('/admin/audit', { headers: h.adminHeaders });
		const rows = ((await audit.json()) as { audit: Array<Record<string, unknown>> }).audit;
		const flagged = rows.find((e) => e.action === 'payment.quantity_mismatch');
		expect(flagged, 'paying for three and getting one must leave a trail').toBeDefined();
		expect(flagged?.detail).toMatchObject({ quantity: 3, issued: 1 });
	});

	it('says nothing about quantity on an ordinary single-unit checkout', async () => {
		await h.app.request('/admin/products/clementine', {
			method: 'PATCH',
			headers: h.adminHeaders,
			body: JSON.stringify({ stripe_price_lifetime: 'price_life_1' }),
		});
		h.deps.stripe = fakeStripeGateway({}, { cs_one: [{ priceId: 'price_life_1', quantity: 1 }] });
		await webhook(h.app, {
			id: 'evt_one',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_one',
					mode: 'payment',
					payment_status: 'paid',
					customer_email: 'single@example.com',
					metadata: {},
				},
			},
		});
		const audit = await h.app.request('/admin/audit', { headers: h.adminHeaders });
		const rows = ((await audit.json()) as { audit: Array<Record<string, unknown>> }).audit;
		expect(rows.find((e) => e.action === 'payment.quantity_mismatch')).toBeUndefined();
	});

	it('records a payment it cannot fulfil instead of silently dropping it', async () => {
		// A price nobody configured (someone edited it in Stripe). We answer 200 so Stripe
		// stops retrying, so the only way anyone finds out is a durable record.
		h.deps.stripe = fakeStripeGateway({}, { cs_unknown: ['price_not_configured'] });
		const r = await webhook(h.app, {
			id: 'evt_unresolved',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_unknown',
					mode: 'payment',
					payment_status: 'paid',
					customer_email: 'lost@example.com',
					metadata: {},
				},
			},
		});
		expect(r.status).toBe(200);
		expect(await keysForEmail(h, 'lost@example.com')).toHaveLength(0);

		const audit = await h.app.request('/admin/audit', { headers: h.adminHeaders });
		const rows = ((await audit.json()) as { audit: Array<Record<string, unknown>> }).audit;
		const unfulfilled = rows.find((e) => e.action === 'payment.unfulfilled');
		expect(unfulfilled, 'an unfulfillable payment must leave a trail').toBeDefined();
		expect(JSON.stringify(unfulfilled?.detail)).toContain('cs_unknown');
	});

	it('retries only the email when the first send fails (email_sent_at stays NULL)', async () => {
		h.email.failNext = true;
		const first = await webhook(h.app, checkout());
		expect(first.status).toBe(500);
		let keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys).toHaveLength(1); // license issued
		expect(keys[0]?.email_sent_at).toBeNull();
		// Redelivery: no new license, email now sent.
		const retry = await webhook(h.app, checkout());
		expect(retry.status).toBe(200);
		keys = await keysForEmail(h, 'buyer@example.com');
		expect(keys).toHaveLength(1);
		expect(keys[0]?.email_sent_at).not.toBeNull();
		expect(h.email.sent).toHaveLength(1);
	});
});

describe('product resolution trusts the price, not the label (PRD §13)', () => {
	it('issues for the product that owns the paid price even when metadata says otherwise', async () => {
		await createProduct(h.app, {
			slug: 'hexis',
			name: 'Hexis',
			key_prefix: 'HEX',
			email_from: 'r@hexis.app',
			stripe_price_lifetime: 'price_hex_life',
		});
		await h.app.request('/admin/products/clementine', {
			method: 'PATCH',
			headers: h.adminHeaders,
			body: JSON.stringify({ stripe_price_lifetime: 'price_clem_life' }),
		});
		// The buyer paid Clementine's price; a stale landing page labelled the session 'hexis'.
		h.deps.stripe = fakeStripeGateway({}, { cs_mislabelled: ['price_clem_life'] });

		await webhook(h.app, {
			id: 'evt_mislabelled',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_mislabelled',
					mode: 'payment',
					payment_status: 'paid',
					customer_email: 'buyer@example.com',
					metadata: { product: 'hexis' },
				},
			},
		});

		const clemKeys = await keysForEmail(h, 'buyer@example.com');
		expect(clemKeys).toHaveLength(1);

		const hexRes = await h.app.request('/admin/products/hexis/keys', { headers: h.adminHeaders });
		expect(((await hexRes.json()) as { keys: unknown[] }).keys).toHaveLength(0);
	});

	it('still falls back to metadata when no price matches a product', async () => {
		h.deps.stripe = fakeStripeGateway({}, { cs_meta_only: ['price_unknown'] });
		await webhook(h.app, {
			id: 'evt_meta_only',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_meta_only',
					mode: 'payment',
					payment_status: 'paid',
					customer_email: 'fallback@example.com',
					metadata: { product: 'clementine' },
				},
			},
		});
		expect(await keysForEmail(h, 'fallback@example.com')).toHaveLength(1);
	});
});
