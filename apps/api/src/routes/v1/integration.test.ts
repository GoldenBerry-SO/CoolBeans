// ABOUTME: Public integration docs routes (#64) — the agent guide and per-product brief, no auth.
// ABOUTME: Asserts they serve markdown with the product's real config and 404 an unknown slug.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct } from '../../test/seed.js';

let h: TestHarness;

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'acme-app',
		name: 'Acme App',
		key_prefix: 'ACME',
		email_from: 'keys@acme.com',
	});
});

describe('GET /v1/llms.txt', () => {
	it('serves the agent guide as markdown, no auth', async () => {
		const res = await h.app.request('/v1/llms.txt');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/markdown');
		const body = await res.text();
		expect(body).toContain('/v1/activate');
		expect(body).toMatch(/never lock/i);
	});
});

describe('GET /v1/integration/:slug', () => {
	it('serves a per-product brief with the real config, no auth', async () => {
		const res = await h.app.request('/v1/integration/acme-app');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/markdown');
		const body = await res.text();
		expect(body).toContain('acme-app');
		expect(body).toContain('ACME');
		// Links back to the guide so an agent can fetch both.
		expect(body).toContain('/v1/llms.txt');
	});

	it('404s an unknown product, so it never confirms one that is not there', async () => {
		const res = await h.app.request('/v1/integration/nope');
		expect(res.status).toBe(404);
	});
});
