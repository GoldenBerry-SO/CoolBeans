// ABOUTME: The Overview validations chart endpoint (issue #37) — real counts, not a placeholder.
// ABOUTME: Asserts a validate call moves the chart, so the wiring cannot silently rot.

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

const publicPost = (path: string, body: unknown) =>
	h.app.request(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

async function chart() {
	const res = await h.app.request('/admin/validations', { headers: h.adminHeaders });
	return (await res.json()) as { ok: boolean; validations: Array<{ day: string; count: number }> };
}

describe('GET /admin/validations', () => {
	it('returns a gapless window so the chart always renders', async () => {
		const body = await chart();
		expect(body.ok).toBe(true);
		expect(body.validations).toHaveLength(16);
		expect(body.validations.every((d) => typeof d.count === 'number')).toBe(true);
	});

	it('counts a real validation against today', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'buyer@example.com',
			tier: 'lifetime',
		});
		const activated = await publicPost('/v1/activate', {
			license_key: key,
			instance_name: 'Studio iMac',
		});
		const { instance } = (await activated.json()) as { instance: { id: string } };

		const before = (await chart()).validations.at(-1)?.count ?? 0;
		await publicPost('/v1/validate', { license_key: key, instance_id: instance.id });
		await publicPost('/v1/validate', { license_key: key, instance_id: instance.id });
		expect((await chart()).validations.at(-1)?.count).toBe(before + 2);
	});

	it('needs an admin token like every other console surface', async () => {
		const res = await h.app.request('/admin/validations');
		expect(res.status).toBe(401);
	});
});
