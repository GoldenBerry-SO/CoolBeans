// ABOUTME: Customer portal tests (PRD §15) — key lookup lists devices; deactivate frees a seat.
// ABOUTME: The key is the credential; a disabled key still shows its definitive status.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../../test/harness.js';
import { rawExec } from '../../test/pg.js';
import { createProduct, issueKey, post } from '../../test/seed.js';

let h: TestHarness;
let key: string;

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
		download_url: 'https://clementine.email/download',
	});
	key = await issueKey(h.app, {
		product: 'clementine',
		email: 'buyer@example.com',
		tier: 'yearly',
	});
});

describe('POST /v1/portal/lookup', () => {
	it('lists the license and its live devices, with the download link', async () => {
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Mac' });
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'iMac' });
		const r = await post(h.app, '/v1/portal/lookup', { license_key: key });
		expect(r.status).toBe(200);
		expect((r.body.license as { status: string }).status).toBe('active');
		expect(r.body.download_url).toBe('https://clementine.email/download');
		expect((r.body.activations as unknown[]).length).toBe(2);
	});

	it('a portal deactivate frees the seat', async () => {
		const act = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'Mac' });
		const instanceId = (act.body.instance as { id: string }).id;
		await post(h.app, '/v1/deactivate', { license_key: key, instance_id: instanceId });
		const r = await post(h.app, '/v1/portal/lookup', { license_key: key });
		expect((r.body.activations as unknown[]).length).toBe(0);
	});

	it('shows a disabled license its definitive status', async () => {
		await h.app.request(`/admin/keys/${key}/disable`, { method: 'POST', headers: h.adminHeaders });
		const r = await post(h.app, '/v1/portal/lookup', { license_key: key });
		expect((r.body.license as { status: string }).status).toBe('disabled');
	});
});

/**
 * Recovery renders and sends AFTER responding, on purpose: doing that work first would
 * make response time reveal whether the address belongs to a buyer. Tests therefore have
 * to let the deferred work settle before asserting on the mailbox.
 */
async function flushDeferredEmail(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setImmediate(resolve));
}

describe('portal recovery by email (PRD §15, issue #35)', () => {
	it('emails the keys to the address instead of returning them', async () => {
		await issueKey(h.app, { product: 'clementine', email: 'buyer@example.com', tier: 'lifetime' });
		h.email.sent.length = 0;

		const res = await post(h.app, '/v1/portal/recover', { email: 'buyer@example.com' });
		expect(res.status).toBe(200);
		// The response must not carry the keys: email is not a credential.
		expect(JSON.stringify(res.body)).not.toContain('CLEM-');

		await flushDeferredEmail();
		expect(h.email.sent).toHaveLength(1);
		expect(h.email.sent[0].to).toBe('buyer@example.com');
		expect(h.email.sent[0].html).toContain('CLEM-');
	});

	it('answers identically for an unknown email so it cannot be used to probe buyers', async () => {
		const known = await post(h.app, '/v1/portal/recover', { email: 'buyer@example.com' });
		// Let the known-address send land BEFORE clearing, or it arrives during the
		// unknown-address assertion and looks like a leak that isn't there.
		await flushDeferredEmail();
		h.email.sent.length = 0;
		const unknown = await post(h.app, '/v1/portal/recover', { email: 'nobody@example.com' });
		expect(unknown.status).toBe(known.status);
		expect(unknown.body).toEqual(known.body);

		await flushDeferredEmail();
		expect(h.email.sent).toHaveLength(0);
	});
});

describe('billing portal session (PRD §15, issue #35)', () => {
	it('hands a subscriber a provider billing-portal URL', async () => {
		h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: 'whsec_test' };
		h.deps.stripe = {
			...fakeStripeGateway(),
			async billingPortalSession(customerId: string, returnUrl: string) {
				return `https://billing.stripe.test/session?c=${customerId}&r=${encodeURIComponent(returnUrl)}`;
			},
		};
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'sub@example.com',
			tier: 'yearly',
		});
		// Attach a Stripe customer to the purchase behind this key.
		await rawExec("UPDATE purchases SET provider = 'stripe', provider_customer_id = 'cus_123'");

		const res = await post(h.app, '/v1/portal/billing-session', {
			license_key: key,
			return_url: 'https://clementine.email/account',
		});
		expect(res.status).toBe(200);
		expect(res.body.url).toContain('cus_123');
	});

	it('tells a lifetime buyer plainly that there is nothing to manage', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'life@example.com',
			tier: 'lifetime',
		});
		const res = await post(h.app, '/v1/portal/billing-session', { license_key: key });
		expect(res.status).toBe(404);
		expect(res.body.error).toBe('no_billing_account');
	});
});
