// ABOUTME: Console data-shape tests — the admin list endpoints carry what the dashboard renders.
// ABOUTME: Keys rows include the buyer email; product rows include key counts for the cards.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, issueKey } from '../../test/seed.js';

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

describe('GET /admin/products/:slug/keys', () => {
	it('includes the customer email on each row', async () => {
		await issueKey(h.app, { product: 'clementine', email: 'buyer@example.com', tier: 'lifetime' });
		const res = await h.app.request('/admin/products/clementine/keys', {
			headers: h.adminHeaders,
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { keys: { customer_email: string | null }[] };
		expect(body.keys).toHaveLength(1);
		expect(body.keys[0].customer_email).toBe('buyer@example.com');
	});
});

describe('GET /admin/products', () => {
	it('includes total and active key counts per product', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'one@example.com',
			tier: 'lifetime',
		});
		await issueKey(h.app, { product: 'clementine', email: 'two@example.com', tier: 'yearly' });
		await h.app.request(`/admin/keys/${encodeURIComponent(key)}/disable`, {
			method: 'POST',
			headers: h.adminHeaders,
		});

		const res = await h.app.request('/admin/products', { headers: h.adminHeaders });
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			products: { slug: string; keysTotal: number; keysActive: number }[];
		};
		const clem = body.products.find((p) => p.slug === 'clementine');
		expect(clem?.keysTotal).toBe(2);
		expect(clem?.keysActive).toBe(1);
	});

	it('never ships webhook secrets or token hashes in the list', async () => {
		const res = await h.app.request('/admin/products', { headers: h.adminHeaders });
		const body = (await res.json()) as { products: Record<string, unknown>[] };
		for (const p of body.products) {
			expect(p).not.toHaveProperty('stripeWebhookSecret');
			expect(p).not.toHaveProperty('productTokenHash');
		}
	});
});

describe('key prefix bounds (PRD §9/§10)', () => {
	it('rejects a prefix the public key gate could never accept', async () => {
		// looksLikeKey() only admits 2–12 letter prefixes, so anything outside that
		// range would issue keys every public endpoint answers with 422 invalid_key.
		for (const key_prefix of ['X', 'THIRTEENCHARS']) {
			const res = await h.app.request('/admin/products', {
				method: 'POST',
				headers: h.adminHeaders,
				body: JSON.stringify({
					slug: `p-${key_prefix.toLowerCase()}`,
					name: 'Edge',
					key_prefix,
					email_from: 'r@edge.email',
				}),
			});
			expect(res.status).toBe(422);
		}
	});

	it('a key issued for an accepted prefix always passes the public gate', async () => {
		await h.app.request('/admin/products', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				slug: 'shortpfx',
				name: 'Short',
				key_prefix: 'AB',
				email_from: 'r@short.email',
			}),
		});
		const issued = await h.app.request('/admin/keys', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({ product: 'shortpfx', email: 'b@example.com', tier: 'lifetime' }),
		});
		const key = ((await issued.json()) as { key: string }).key;
		const act = await h.app.request('/v1/activate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ license_key: key, instance_name: 'Mac' }),
		});
		expect(act.status).toBe(200);
	});
});
