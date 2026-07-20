// ABOUTME: Admin input boundary tests — invalid query and cross-field values stay uniform 4xx errors.
// ABOUTME: Prevents malformed console/CLI input from becoming a 500 or violating license invariants.

import { purchases } from '@coolbeans/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct } from '../../test/seed.js';

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

describe('GET /admin/audit limit', () => {
	it.each(['0', '-1', '1.5', 'not-a-number'])(
		'rejects invalid limit=%s with the uniform error envelope',
		async (limit) => {
			const res = await h.app.request(`/admin/audit?limit=${limit}`, {
				headers: h.adminHeaders,
			});
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ ok: false, error: 'bad_request' });
		},
	);

	it('accepts a large limit and caps it internally', async () => {
		const res = await h.app.request('/admin/audit?limit=501', { headers: h.adminHeaders });
		expect(res.status).toBe(200);
	});
});

describe('POST /admin/keys expiry options', () => {
	async function issue(body: Record<string, unknown>) {
		return h.app.request('/admin/keys', {
			method: 'POST',
			headers: h.adminHeaders,
			body: JSON.stringify({
				product: 'clementine',
				email: 'buyer@example.com',
				...body,
			}),
		});
	}

	it.each([
		{ tier: 'lifetime', expires_at: '2027-01-01T00:00:00.000Z' },
		{ tier: 'lifetime', trial_days: 7 },
		{ tier: 'yearly', trial_days: 7 },
		{ tier: 'trial', trial_days: 7, expires_at: '2027-01-01T00:00:00.000Z' },
	])('rejects contradictory expiry input %#', async (body) => {
		const res = await issue(body);
		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({ ok: false, error: 'validation_error' });
		expect(await h.deps.db.select().from(purchases)).toHaveLength(0);
	});

	it('still accepts an advisory yearly expiry', async () => {
		const res = await issue({ tier: 'yearly', expires_at: '2027-01-01T00:00:00.000Z' });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			license: { tier: 'yearly', expires_at: '2027-01-01T00:00:00.000Z' },
		});
	});

	it('gives a yearly key a year when no expiry is supplied', async () => {
		// A yearly licence with no expiry never lapses: the sweep only disables trials and
		// validate only expires trials lazily, so it is a lifetime key issued by accident.
		// The console has no expiry field, so every yearly comp went out that way.
		const res = await issue({ tier: 'yearly' });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { license: { expires_at: string | null } };
		expect(body.license.expires_at).not.toBeNull();

		const expires = new Date(body.license.expires_at as string).getTime();
		const aYearOut = new Date(h.clock.now().getTime()).setUTCFullYear(
			h.clock.now().getUTCFullYear() + 1,
		);
		expect(Math.abs(expires - aYearOut)).toBeLessThan(60_000);
	});

	it('leaves a lifetime key with no expiry', async () => {
		const res = await issue({ tier: 'lifetime' });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ license: { tier: 'lifetime', expires_at: null } });
	});
});
