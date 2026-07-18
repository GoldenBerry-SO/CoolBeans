// ABOUTME: Console magic-code auth tests — bootstrap create-account, sign-in, sessions, sign-out.
// ABOUTME: Codes arrive via the captured email sender; no enumeration through request-code.

import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
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

describe('audit attribution (PRD §16)', () => {
	it('names the signed-in admin as the actor, not a generic "admin"', async () => {
		await post('/auth/request-code', { email: 'chris@goldenberry.io' });
		const verify = await post('/auth/verify', {
			email: 'chris@goldenberry.io',
			code: lastCode(),
			name: 'Chris',
		});
		const session = verify.body.token as string;

		await post(
			'/admin/products',
			{
				slug: 'clementine',
				name: 'Clementine',
				key_prefix: 'CLEM',
				email_from: 'r@clementine.email',
			},
			session,
		);
		const issued = await post(
			'/admin/keys',
			{ product: 'clementine', email: 'buyer@example.com', tier: 'lifetime' },
			session,
		);
		const key = issued.body.key as string;
		await post(`/admin/keys/${encodeURIComponent(key)}/disable`, {}, session);

		const res = await h.app.request('/admin/audit', {
			headers: { Authorization: `Bearer ${session}` },
		});
		const audit = (await res.json()) as { audit: { action: string; actor: string }[] };
		const disabled = audit.audit.find((e) => e.action === 'license.disabled');
		expect(disabled?.actor).toBe('admin:chris@goldenberry.io');

		// The env admin token stays distinguishable from a human session.
		const viaToken = await h.app.request('/admin/products', { headers: h.adminHeaders });
		expect(viaToken.status).toBe(200);
	});
});

describe('dev convenience: logging the magic code', () => {
	it('logs the code when explicitly enabled for local development', async () => {
		h = makeHarness({ config: { logMagicCodes: true } });
		await post('/auth/request-code', { email: 'chris@goldenberry.io' });
		const code = lastCode();
		const logged = h.logger.lines.find((l) => l.message.includes('magic code'));
		expect(logged).toBeTruthy();
		expect(JSON.stringify(logged)).toContain(code);
	});

	it('still issues a usable code with no email sender, which is the point of the flag', async () => {
		// The local setup this exists for has no Resend key and no SMTP: if we bail before
		// generating a code, a developer still cannot sign in.
		h = makeHarness({ config: { logMagicCodes: true } });
		h.deps.email = undefined;

		const req = await post('/auth/request-code', { email: 'chris@goldenberry.io' });
		expect(req.status).toBe(200);

		const logged = h.logger.lines.find((l) => l.message.includes('magic code'));
		const code = (logged?.fields as { code: string } | undefined)?.code;
		expect(code).toMatch(/^\d{6}$/);

		const verify = await post('/auth/verify', { email: 'chris@goldenberry.io', code });
		expect(verify.status).toBe(200);
		expect(verify.body.token).toBeTruthy();
	});

	it('never logs the code by default', async () => {
		await post('/auth/request-code', { email: 'chris@goldenberry.io' });
		const code = lastCode();
		expect(JSON.stringify(h.logger.lines)).not.toContain(code);
	});

	it('refuses to start with code logging enabled outside development', () => {
		// A code is a credential (§19). Making this a config error means it cannot be
		// switched on in production by accident or by a copied .env.
		expect(() =>
			loadConfig({
				ADMIN_TOKEN: 'a'.repeat(20),
				SIGNING_KEY_SECRET: 'b'.repeat(20),
				LOG_MAGIC_CODES: 'true',
				NODE_ENV: 'production',
			} as NodeJS.ProcessEnv),
		).toThrow(/LOG_MAGIC_CODES/);
	});
});
