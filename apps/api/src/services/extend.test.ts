// ABOUTME: Extending a licence's expiry (issue #93) — the manual-yearly renewal verb.
// ABOUTME: Perpetual is refused, past dates are refused, and a lapsed app unlocks on next check.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { rawQuery } from '../test/pg.js';
import { createProduct, issueKey, post } from '../test/seed.js';

let h: TestHarness;

const ADMIN = {
	Authorization: 'Bearer test-admin-token-0123456789',
	'Content-Type': 'application/json',
};

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clem.test',
	});
});

async function extend(key: string, expiresAt: string) {
	const res = await h.app.request(`/admin/keys/${encodeURIComponent(key)}/extend`, {
		method: 'POST',
		headers: ADMIN,
		body: JSON.stringify({ expires_at: expiresAt }),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function isoDaysFromNow(days: number): string {
	return new Date(h.clock.now().getTime() + days * 86_400_000).toISOString();
}

describe('POST /admin/keys/:key/extend', () => {
	it('sets a new future expiry on a subscription and audits old and new', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'b@x.test',
			kind: 'subscription',
		});
		const target = isoDaysFromNow(730);
		const r = await extend(key, target);
		expect(r.status).toBe(200);
		expect((r.body.license as { expires_at: string }).expires_at).toBe(target);

		const [audit] = await rawQuery<{ detail: string; account_id: number }>(
			"SELECT detail, account_id FROM audit_log WHERE action = 'license.expiry_extended' ORDER BY id DESC LIMIT 1",
		);
		const detail = JSON.parse(audit.detail) as { from: string; to: string };
		expect(detail.to).toBe(target);
		expect(detail.from).toBeTruthy();
		expect(audit.account_id).toBe(1);
	});

	it('refuses a perpetual licence with a message that says why', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'b@x.test',
			kind: 'perpetual',
		});
		const r = await extend(key, isoDaysFromNow(365));
		expect(r.status).toBeGreaterThanOrEqual(400);
		expect(JSON.stringify(r.body)).toMatch(/perpetual|never expires/i);
	});

	it('refuses a date in the past — that is what disable is for', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'b@x.test',
			kind: 'subscription',
		});
		const r = await extend(key, new Date(h.clock.now().getTime() - 86_400_000).toISOString());
		expect(r.status).toBeGreaterThanOrEqual(400);
		expect(JSON.stringify(r.body)).toMatch(/past|future/i);
	});

	it('allows shortening to an earlier-but-future date', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'b@x.test',
			kind: 'subscription',
		});
		const sooner = isoDaysFromNow(30);
		const r = await extend(key, sooner);
		expect(r.status).toBe(200);
		expect((r.body.license as { expires_at: string }).expires_at).toBe(sooner);
	});

	it('re-enables a trial that lapsed, since the new expiry supersedes the old lapse', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'b@x.test',
			kind: 'trial',
			trial_days: 7,
		});
		h.clock.advance(10 * 86_400_000);
		// Lazy expiry: touching the key disables it.
		await post(h.app, '/v1/validate', { license_key: key, instance_id: 'nope' });
		const r = await extend(key, isoDaysFromNow(14));
		expect(r.status).toBe(200);
		expect((r.body.license as { status: string }).status).toBe('active');

		// And it stays active: the next public touch must not lazily re-disable it.
		const v = await post(h.app, '/v1/validate', { license_key: key, instance_id: 'nope' });
		expect((v.body.license as { status: string }).status).toBe('active');
	});

	it('refuses a licence disabled for any other reason, pointing at re-enable', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'b@x.test',
			kind: 'subscription',
		});
		await h.app.request(`/admin/keys/${encodeURIComponent(key)}/disable`, {
			method: 'POST',
			headers: ADMIN,
		});
		const r = await extend(key, isoDaysFromNow(365));
		expect(r.status).toBeGreaterThanOrEqual(400);
		expect(JSON.stringify(r.body)).toMatch(/enable/i);
	});

	it('an app past the old expiry gets a token carrying the new one on its next check', async () => {
		const key = await issueKey(h.app, {
			product: 'clementine',
			email: 'b@x.test',
			kind: 'subscription',
			expires_at: isoDaysFromNow(30),
		});
		const activated = await post(h.app, '/v1/activate', {
			license_key: key,
			instance_name: 'renewing-mac',
		});
		const instanceId = (activated.body.instance as { id: string }).id;

		// The year passes; the customer pays for another one; the operator extends.
		h.clock.advance(40 * 86_400_000);
		const renewed = isoDaysFromNow(365);
		expect((await extend(key, renewed)).status).toBe(200);

		const v = await post(h.app, '/v1/validate', { license_key: key, instance_id: instanceId });
		expect(v.status).toBe(200);
		expect(v.body.valid).toBe(true);
		expect((v.body.license as { expires_at: string }).expires_at).toBe(renewed);
		// The signed claim is the licence expiry plus the reconnect buffer, so the app's
		// offline cutoff moves past the renewal — that is what unlocks the lapsed machine.
		const payload = JSON.parse(
			Buffer.from((v.body.token as string).split('.')[1] ?? '', 'base64url').toString('utf8'),
		) as { expires_at: string };
		expect(new Date(payload.expires_at).getTime()).toBeGreaterThanOrEqual(
			new Date(renewed).getTime(),
		);
	});

	it('404s an unknown key, never 403', async () => {
		const r = await extend('CLEM-0000-0000-0000-0000', isoDaysFromNow(365));
		expect(r.status).toBe(404);
	});
});
