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

	it('lists the capability names this product actually grants', async () => {
		// The names come from the vendor's own grants, so a coding agent never has to guess one —
		// and a guessed name silently leaves a paid feature switched off.
		const { seedGrant } = await import('../../test/seed.js');
		const product = await h.app.request('/admin/products/acme-app', { headers: h.adminHeaders });
		const { product: found } = (await product.json()) as { product: { id: number } };
		await seedGrant(h.deps, {
			productId: found.id,
			priceId: 'price_acmePro',
			kind: 'perpetual',
			entitlements: { export_4k: true, batch_limit: 100 },
		});
		const res = await h.app.request('/v1/integration/acme-app');
		const body = await res.text();
		expect(body).toContain('export_4k');
		expect(body).toContain('batch_limit');
	});

	it('still lists a capability whose price was retired', async () => {
		// Licences issued before a price was retired still carry its capabilities, so an app still
		// has to honour them. Absent means off, so a name listed but no longer sold costs nothing,
		// while a name omitted leaves a paying customer without the feature they bought.
		const { seedGrant } = await import('../../test/seed.js');
		const { rawQuery } = await import('../../test/pg.js');
		const product = await h.app.request('/admin/products/acme-app', { headers: h.adminHeaders });
		const { product: found } = (await product.json()) as { product: { id: number } };
		await seedGrant(h.deps, {
			productId: found.id,
			priceId: 'price_acmeOld',
			kind: 'perpetual',
			entitlements: { legacy_filters: true },
		});
		await rawQuery("UPDATE license_grants SET status = 'retired' WHERE stripe_price_id = $1", [
			'price_acmeOld',
		]);
		const body = await (await h.app.request('/v1/integration/acme-app')).text();
		expect(body).toContain('legacy_filters');
	});

	it('lists capabilities from hand-issued licences, so a manual-only vendor is not lied about', async () => {
		// Clementine before Stripe is wired: no grants at all, keys issued by hand carrying
		// export_4k. The brief used to read names from grants only, so it said "this product
		// grants no capabilities" while every licence carried one — and an agent following the
		// docs correctly refused to gate on names that genuinely exist.
		const res = await h.app.request('/admin/keys', {
			method: 'POST',
			headers: { ...h.adminHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				product: 'acme-app',
				email: 'comp@example.com',
				kind: 'perpetual',
				entitlements: { export_4k: true, batch_limit: 100 },
			}),
		});
		expect(res.status).toBe(200);
		const body = await (await h.app.request('/v1/integration/acme-app')).text();
		expect(body).toContain('export_4k');
		expect(body).toContain('batch_limit');
		expect(body).not.toMatch(/no capabilit/i);
		// The licence key itself must not leak into a public document.
		const key = ((await res.json()) as { key: string }).key;
		expect(body).not.toContain(key.replace(/-/g, ''));
	});

	it('merges names from grants and licences without duplicates', async () => {
		const { seedGrant } = await import('../../test/seed.js');
		const product = await h.app.request('/admin/products/acme-app', { headers: h.adminHeaders });
		const { product: found } = (await product.json()) as { product: { id: number } };
		await seedGrant(h.deps, {
			productId: found.id,
			priceId: 'price_acmePro',
			kind: 'perpetual',
			entitlements: { export_4k: true },
		});
		await h.app.request('/admin/keys', {
			method: 'POST',
			headers: { ...h.adminHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				product: 'acme-app',
				email: 'comp@example.com',
				kind: 'perpetual',
				entitlements: { export_4k: true, legacy_filters: true },
			}),
		});
		const body = await (await h.app.request('/v1/integration/acme-app')).text();
		// One mention in the names list, not one per source.
		const names = body.slice(body.indexOf('## Capabilities'), body.indexOf('## Endpoints'));
		expect(names.match(/`export_4k`/g)).toHaveLength(1);
		expect(names).toContain('legacy_filters');
	});

	it('never leaks the price a capability came from', async () => {
		// Grant ids and Stripe price ids are the vendor's business, not the app's.
		const { seedGrant } = await import('../../test/seed.js');
		const product = await h.app.request('/admin/products/acme-app', { headers: h.adminHeaders });
		const { product: found } = (await product.json()) as { product: { id: number } };
		await seedGrant(h.deps, {
			productId: found.id,
			priceId: 'price_acmeSecret',
			kind: 'perpetual',
			entitlements: { export_4k: true },
		});
		const body = await (await h.app.request('/v1/integration/acme-app')).text();
		expect(body).not.toContain('price_acmeSecret');
	});

	it('404s an unknown product, so it never confirms one that is not there', async () => {
		const res = await h.app.request('/v1/integration/nope');
		expect(res.status).toBe(404);
	});
});
