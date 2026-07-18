// ABOUTME: Console magic-code auth tests — bootstrap create-account, sign-in, sessions, sign-out.
// ABOUTME: Codes arrive via the captured email sender; no enumeration through request-code.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../test/harness.js';

let h: TestHarness;

function lastCode(): string {
	const email = h.email.sent.at(-1);
	if (!email) throw new Error('no email captured');
	const match = email.subject.match(/^(\d{6}) /);
	if (!match?.[1]) throw new Error(`no code in subject: ${email.subject}`);
	return match[1];
}

async function post(path: string, body: unknown, token?: string) {
	const res = await h.app.request(path, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
	h = makeHarness();
});

describe('console magic-code auth', () => {
	it('first sign-in bootstraps the account and mints a working session', async () => {
		const req = await post('/auth/request-code', { email: 'chris@goldenberry.io' });
		expect(req.status).toBe(200);
		expect(h.email.sent).toHaveLength(1);

		const verify = await post('/auth/verify', {
			email: 'chris@goldenberry.io',
			code: lastCode(),
			name: 'Chris',
		});
		expect(verify.status).toBe(200);
		const token = verify.body.token as string;
		expect(token.startsWith('cbs_')).toBe(true);
		expect((verify.body.admin as { email: string }).email).toBe('chris@goldenberry.io');

		// The session works against the admin API.
		const res = await h.app.request('/admin/products', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
	});

	it('after bootstrap, unknown emails get the same answer but no code (no enumeration)', async () => {
		await post('/auth/request-code', { email: 'chris@goldenberry.io' });
		await post('/auth/verify', { email: 'chris@goldenberry.io', code: lastCode() });
		const sentBefore = h.email.sent.length;

		const req = await post('/auth/request-code', { email: 'stranger@evil.io' });
		expect(req.status).toBe(200); // same envelope…
		expect(h.email.sent.length).toBe(sentBefore); // …but nothing was sent
	});

	it('rejects a wrong code and locks after too many attempts', async () => {
		await post('/auth/request-code', { email: 'chris@goldenberry.io' });
		for (let i = 0; i < 5; i++) {
			const bad = await post('/auth/verify', { email: 'chris@goldenberry.io', code: '000000' });
			expect(bad.status).toBe(401);
		}
		// Even the right code is dead after the attempt cap.
		const right = await post('/auth/verify', { email: 'chris@goldenberry.io', code: lastCode() });
		expect(right.status).toBe(401);
	});

	it('codes expire', async () => {
		await post('/auth/request-code', { email: 'chris@goldenberry.io' });
		const code = lastCode();
		h.clock.advance(11 * 60_000);
		const verify = await post('/auth/verify', { email: 'chris@goldenberry.io', code });
		expect(verify.status).toBe(401);
	});

	it('a code is single-use', async () => {
		await post('/auth/request-code', { email: 'chris@goldenberry.io' });
		const code = lastCode();
		expect((await post('/auth/verify', { email: 'chris@goldenberry.io', code })).status).toBe(200);
		expect((await post('/auth/verify', { email: 'chris@goldenberry.io', code })).status).toBe(401);
	});

	it('sign-out revokes the session', async () => {
		await post('/auth/request-code', { email: 'chris@goldenberry.io' });
		const verify = await post('/auth/verify', { email: 'chris@goldenberry.io', code: lastCode() });
		const token = verify.body.token as string;
		await post('/auth/signout', {}, token);
		const res = await h.app.request('/admin/products', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(401);
	});

	it('sessions expire after their TTL', async () => {
		await post('/auth/request-code', { email: 'chris@goldenberry.io' });
		const verify = await post('/auth/verify', { email: 'chris@goldenberry.io', code: lastCode() });
		const token = verify.body.token as string;
		h.clock.advance(31 * 86_400_000);
		const res = await h.app.request('/admin/products', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(401);
	});
});
