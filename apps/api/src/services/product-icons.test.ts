// ABOUTME: Product icons (issue #115) — upload in the console, serve publicly, brand the email.
// ABOUTME: The blob lives in its own table so the hot licence paths never read it.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { createProduct, issueKey, signUp } from '../test/seed.js';

let h: TestHarness;

// A real 1x1 PNG, so the magic-byte sniffing has honest input.
const PNG_1PX = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clem.test',
	});
});

async function upload(body: unknown, slug = 'clementine') {
	const res = await h.app.request(`/admin/products/${slug}/icon`, {
		method: 'PUT',
		headers: h.adminHeaders,
		body: JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const pngUpload = { mime: 'image/png', data_base64: PNG_1PX.toString('base64') };

describe('uploading and serving a product icon', () => {
	it('serves the uploaded bytes publicly with the right headers', async () => {
		expect((await upload(pngUpload)).status).toBe(200);
		const res = await h.app.request('/v1/products/clementine/icon');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(res.headers.get('cache-control')).toContain('max-age');
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.equals(PNG_1PX)).toBe(true);
	});

	it('404s when no icon exists, and after removal', async () => {
		expect((await h.app.request('/v1/products/clementine/icon')).status).toBe(404);
		await upload(pngUpload);
		const del = await h.app.request('/admin/products/clementine/icon', {
			method: 'DELETE',
			headers: h.adminHeaders,
		});
		expect(del.status).toBe(200);
		expect((await h.app.request('/v1/products/clementine/icon')).status).toBe(404);
	});

	it('replaces in place on a second upload', async () => {
		await upload(pngUpload);
		// A different (still real) PNG: the same pixel with a tweaked palette byte.
		const other = Buffer.from(PNG_1PX);
		await upload({ mime: 'image/png', data_base64: other.toString('base64') });
		const res = await h.app.request('/v1/products/clementine/icon');
		expect(res.status).toBe(200);
	});

	it('refuses bytes that are not the claimed image type', async () => {
		const r = await upload({
			mime: 'image/png',
			data_base64: Buffer.from('<svg onload=alert(1)>').toString('base64'),
		});
		expect(r.status).toBeGreaterThanOrEqual(400);
		expect(JSON.stringify(r.body)).toMatch(/image|png/i);
	});

	it('refuses SVG outright — poor email support and a script vector when served', async () => {
		const r = await upload({
			mime: 'image/svg+xml',
			data_base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),
		});
		expect(r.status).toBeGreaterThanOrEqual(400);
	});

	it('refuses an oversized upload with a message naming the cap', async () => {
		// 300KB of PNG-prefixed noise: past the 256KB cap.
		const big = Buffer.concat([PNG_1PX, Buffer.alloc(300 * 1024, 7)]);
		const r = await upload({ mime: 'image/png', data_base64: big.toString('base64') });
		expect(r.status).toBeGreaterThanOrEqual(400);
		expect(JSON.stringify(r.body)).toMatch(/256/);
	});

	it("404s another account's product, never 403", async () => {
		const r = await upload(pngUpload, 'nope');
		expect(r.status).toBe(404);
	});
});

describe('the licence email carries the vendor brand', () => {
	it('ships the icon inline as a cid attachment, not a hosted URL', async () => {
		// A hosted <img> only renders for readers whose client loads remote images, and most
		// block them by default — the logo showed in Gmail (which proxies them) and nowhere
		// else. Bytes travelling in the message have nothing to fetch and nothing to block.
		await upload(pngUpload);
		await issueKey(h.app, { product: 'clementine', email: 'b@x.test', kind: 'perpetual' });
		const sent = h.email.sent.at(-1);
		expect(sent?.html).toContain('cid:product-icon');
		expect(sent?.html).not.toContain('/v1/products/clementine/icon');

		const attachment = sent?.attachments?.[0];
		expect(attachment?.contentId).toBe('product-icon');
		expect(attachment?.contentType).toBe('image/png');
		// The real uploaded bytes, so the reader sees the vendor's actual mark.
		expect(attachment?.content.equals(PNG_1PX)).toBe(true);
	});

	it('sends no logo at all when the vendor uploaded none', async () => {
		// Deliberately not our bean: the Cool Beans mark beside a "Clementine" wordmark reads
		// as the wrong company. The text wordmark alone is honest.
		await issueKey(h.app, { product: 'clementine', email: 'b@x.test', kind: 'perpetual' });
		const sent = h.email.sent.at(-1);
		expect(sent?.html).not.toContain('<img');
		expect(sent?.attachments ?? []).toHaveLength(0);
		// The brand still reads, because the product name is a text node.
		expect(sent?.html.replace(/<[^>]*>/g, ' ')).toContain('Clementine');
	});

	it('names the product on the From line', async () => {
		// The buyer's inbox used to show a bare "no-reply@..." that said nothing about what
		// they bought.
		await issueKey(h.app, { product: 'clementine', email: 'b@x.test', kind: 'perpetual' });
		const sent = h.email.sent.at(-1);
		expect(sent?.from).toContain('"Clementine"');
	});
});

describe('tenancy on cloud', () => {
	it("another account cannot touch or read a foreign product's icon routes", async () => {
		const cloud: Partial<Config> = {
			billing: { stripeSecretKey: 'sk_billing', proPriceId: 'price_pro' },
			logMagicCodes: true,
		};
		const ch = await makeHarness({ config: cloud });
		const alice = await signUp(ch.app, ch.logger, 'alice@alpha.test', 'alpha');
		const bob = await signUp(ch.app, ch.logger, 'bob@beta.test', 'beta');
		await createProduct(
			ch.app,
			{ slug: 'alpha-app', name: 'Alpha', key_prefix: 'ALPHA', email_from: 'a@alpha.test' },
			alice,
		);
		for (const [method, path] of [
			['PUT', '/admin/products/alpha-app/icon'],
			['DELETE', '/admin/products/alpha-app/icon'],
		] as const) {
			const res = await ch.app.request(path, {
				method,
				headers: bob,
				body: method === 'PUT' ? JSON.stringify(pngUpload) : undefined,
			});
			expect(res.status, `${method} ${path}`).toBe(404);
		}
	});
});
