// ABOUTME: Endpoints behind the console's usage and webhook pages (PRD §16, issue #41).
// ABOUTME: Both surfaces rendered permanent empty states because no listing existed.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, defineMetric, issueKey, post } from '../../test/seed.js';

let h: TestHarness;

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
});

describe('GET /admin/usage', () => {
	it('lists metered counters across products with their limits', async () => {
		await defineMetric(h.app, 'clementine', {
			key: 'api_calls',
			display_name: 'API calls',
			default_limit: 10,
			reset_period: 'daily',
		});
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'buyer@example.com',
			tier: 'yearly',
		});
		const act = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Meter' });
		const instanceId = (act.body.instance as { id: string }).id;
		await post(h.app, '/v1/usage/increment', {
			license_key: key,
			instance_id: instanceId,
			metric: 'api_calls',
			delta: 4,
		});

		const res = await h.app.request('/admin/usage', { headers: h.adminHeaders });
		expect(res.status).toBe(200);
		const rows = ((await res.json()) as { usage: Record<string, unknown>[] }).usage;
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			metric: 'api_calls',
			current: 4,
			limit: 10,
			product: 'clementine',
		});
		expect(rows[0].key).toBe(key);
	});

	it('is empty rather than erroring when nothing is metered', async () => {
		const res = await h.app.request('/admin/usage', { headers: h.adminHeaders });
		expect(res.status).toBe(200);
		expect(((await res.json()) as { usage: unknown[] }).usage).toEqual([]);
	});
});

describe('GET /admin/events', () => {
	it('lists processed provider events newest first', async () => {
		h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: 'whsec_test' };
		h.deps.stripe = fakeStripeGateway({}, { cs_evt: ['price_x'] });
		await h.app.request('/admin/products/clementine', {
			method: 'PATCH',
			headers: h.adminHeaders,
			body: JSON.stringify({ stripe_price_lifetime: 'price_x' }),
		});
		await h.app.request('/v1/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 'evt_listed',
				type: 'checkout.session.completed',
				data: {
					object: {
						id: 'cs_evt',
						mode: 'payment',
						payment_status: 'paid',
						customer_email: 'b@example.com',
					},
				},
			}),
		});

		const res = await h.app.request('/admin/events', { headers: h.adminHeaders });
		expect(res.status).toBe(200);
		const events = ((await res.json()) as { events: Record<string, unknown>[] }).events;
		expect(events[0]).toMatchObject({
			id: 'evt_listed',
			provider: 'stripe',
			type: 'checkout.session.completed',
			status: 'done',
		});
	});
});

describe('provider configuration status', () => {
	it('reports which providers are actually wired', async () => {
		h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: 'whsec_test' };
		const res = await h.app.request('/admin/providers', { headers: h.adminHeaders });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { providers: { name: string; configured: boolean }[] };
		expect(body.providers.find((p) => p.name === 'stripe')?.configured).toBe(true);
		expect(body.providers.find((p) => p.name === 'paypal')?.configured).toBe(false);
	});
});
