// ABOUTME: Tests for the ops layer — trial sweep, floating-lease reap, and the durable outbox.
// ABOUTME: Proves the sweep disables offline and the outbox backstop resends only unsent email.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { createProduct, issueKey, post } from '../test/seed.js';
import { drainOutbox } from './outbox.js';
import { reapFloatingLeases, sweepExpiredTrials } from './sweep.js';

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

describe('sweeps', () => {
	it('disables expired trials offline (no validate call needed)', async () => {
		const trialKey = await issueKey(h.app, {
			product: 'clementine',
			email: 't@example.com',
			tier: 'trial',
			trial_days: 1,
		});
		h.clock.advance(2 * 86_400_000);
		expect(sweepExpiredTrials(h.deps)).toBe(1);
		const res = await h.app.request(`/admin/keys/${trialKey}`, { headers: h.adminHeaders });
		const body = (await res.json()) as { license: { status: string; disabled_reason: string } };
		expect(body.license.status).toBe('disabled');
		expect(body.license.disabled_reason).toBe('trial_expired');
	});

	it('reaps expired floating leases', async () => {
		await createProduct(h.app, {
			slug: 'hexis',
			name: 'Hexis',
			key_prefix: 'HEX',
			email_from: 'k@hexis.app',
			activation_model: 'floating',
			floating_lease_minutes: 30,
		});
		const key = await issueKey(h.app, { product: 'hexis', email: 'b@x.io', tier: 'yearly' });
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'a' });
		h.clock.advance(31 * 60_000);
		expect(reapFloatingLeases(h.deps)).toBe(1);
	});
});

describe('outbox backstop', () => {
	it('resends the key email when inline send failed, and is idempotent', async () => {
		h.deps.config.stripe = { secretKey: 'sk', webhookSecret: 'wh' };
		const { fakeStripeGateway } = await import('../test/harness.js');
		h.deps.stripe = fakeStripeGateway();
		h.email.failNext = true;
		// Inline send fails -> 500, but a backstop job was enqueued and license issued.
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
						customer_email: 'b@x.io',
						metadata: { product: 'clementine' },
					},
				},
			}),
		});
		expect(h.email.sent).toHaveLength(0);
		// The backstop is delayed; advance past it, then drain.
		h.clock.advance(11 * 60_000);
		await drainOutbox(h.deps);
		expect(h.email.sent).toHaveLength(1);
		// Draining again does not double-send (email_sent_at now set).
		h.clock.advance(11 * 60_000);
		await drainOutbox(h.deps);
		expect(h.email.sent).toHaveLength(1);
	});
});
