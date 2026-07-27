// ABOUTME: POST /v1/keyset (#73) — an app fetches signing keys by licence key, not by product slug.
// ABOUTME: The key is the credential, so it travels in the body and never in a URL or a log line.

import { beforeEach, describe, expect, it } from 'vitest';
import { type CapturedLine, makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, issueKey } from '../../test/seed.js';

let h: TestHarness;
let key: string;

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'k@clementine.email',
	});
	key = await issueKey(h.app, {
		product: 'clementine',
		email: 'buyer@example.com',
		kind: 'perpetual',
	});
});

async function keyset(body: unknown) {
	const res = await h.app.request('/v1/keyset', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /v1/keyset', () => {
	/** Keys exist once something has been signed, which is the order a real app goes in. */
	async function mintAToken(): Promise<string> {
		const act = await h.app.request('/v1/activate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ license_key: key, instance_name: 'Mac' }),
		});
		const { instance } = (await act.json()) as { instance: { id: string } };
		const val = await h.app.request('/v1/validate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ license_key: key, instance_id: instance.id }),
		});
		return ((await val.json()) as { token: string }).token;
	}

	it('returns the signing keys for the product that licence belongs to', async () => {
		const token = await mintAToken();
		const kid = JSON.parse(Buffer.from(token.split('.')[0] as string, 'base64url').toString())
			.kid as string;
		const r = await keyset({ license_key: key });
		expect(r.status).toBe(200);
		expect(r.body.algorithm).toBe('ed25519');
		const keys = r.body.keys as Record<string, string>;
		// The key that actually signed this app's token is in there, which is the whole job.
		expect(keys[kid]).toBeDefined();
		// Same material the slug-based route serves, so an app can verify either way.
		const viaSlug = await h.app.request('/v1/pubkey?product=clementine');
		expect(keys).toEqual(((await viaSlug.json()) as { keys: unknown }).keys);
	});

	it('accepts a key in display form, dashes and all', async () => {
		const r = await keyset({ license_key: key.toLowerCase() });
		expect(r.status).toBe(200);
	});

	it('refuses an unknown key without confirming whether any product exists', async () => {
		const r = await keyset({ license_key: 'CLEM-Z9Y8-X7W6-V5T4-S3R2' });
		expect(r.status).toBe(404);
		// No slug, product name or key count leaks into the refusal.
		expect(JSON.stringify(r.body)).not.toContain('clementine');
	});

	it('refuses a malformed key', async () => {
		const r = await keyset({ license_key: 'not-a-key' });
		expect(r.status).toBeGreaterThanOrEqual(400);
	});

	it('refuses a request with no key at all', async () => {
		const r = await keyset({});
		expect(r.status).toBeGreaterThanOrEqual(400);
	});

	it('never writes the licence key to a log line', async () => {
		await keyset({ license_key: key });
		const logged = (h.logger.lines as CapturedLine[])
			.map((l) => `${l.message} ${JSON.stringify(l.fields ?? {})}`)
			.join('\n');
		expect(logged).not.toContain(key);
		// Nor the normalized form, which is just as much the credential.
		expect(logged).not.toContain(key.replace(/-/g, ''));
	});

	it('leaves the slug route working for existing integrations', async () => {
		const res = await h.app.request('/v1/pubkey?product=clementine');
		expect(res.status).toBe(200);
	});
});
