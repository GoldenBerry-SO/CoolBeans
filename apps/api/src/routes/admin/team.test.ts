// ABOUTME: Team management tests (PRD §16) — invite a second admin, list, and revoke access.
// ABOUTME: Revoking kills live sessions immediately; the last admin can never be removed.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';

let h: TestHarness;

function lastCode(): string {
	const email = h.email.sent.at(-1);
	if (!email) throw new Error('no email captured');
	const match = email.subject.match(/^(\d{6}) /);
	if (!match?.[1]) throw new Error(`no code in subject: ${email.subject}`);
	return match[1];
}

async function req(method: string, path: string, body?: unknown, token?: string) {
	const res = await h.app.request(path, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Bootstrap the first admin and return a live session token. */
async function signIn(email: string): Promise<string> {
	await req('POST', '/auth/request-code', { email });
	const verify = await req('POST', '/auth/verify', { email, code: lastCode() });
	return verify.body.token as string;
}

beforeEach(async () => {
	h = await makeHarness();
});

describe('team management (PRD §16)', () => {
	it('invites a second admin who can then sign in', async () => {
		const owner = await signIn('chris@goldenberry.io');

		// Before the invite, a stranger gets no code (and no hint that they are unknown).
		const cold = await req('POST', '/auth/request-code', { email: 'sam@goldenberry.io' });
		expect(cold.status).toBe(200);
		expect(h.email.sent).toHaveLength(1);

		const invited = await req('POST', '/admin/team', { email: 'sam@goldenberry.io' }, owner);
		expect(invited.status).toBe(200);

		const sam = await signIn('sam@goldenberry.io');
		const asSam = await h.app.request('/admin/products', {
			headers: { Authorization: `Bearer ${sam}` },
		});
		expect(asSam.status).toBe(200);
	});

	it('lists the team without leaking session material', async () => {
		const owner = await signIn('chris@goldenberry.io');
		await req('POST', '/admin/team', { email: 'sam@goldenberry.io' }, owner);

		const res = await req('GET', '/admin/team', undefined, owner);
		expect(res.status).toBe(200);
		const team = res.body.team as Record<string, unknown>[];
		expect(team.map((m) => m.email).sort()).toEqual(['chris@goldenberry.io', 'sam@goldenberry.io']);
		for (const member of team) {
			expect(Object.keys(member)).not.toContain('tokenHash');
		}
	});

	it('revoking an admin kills their live session immediately', async () => {
		const owner = await signIn('chris@goldenberry.io');
		await req('POST', '/admin/team', { email: 'sam@goldenberry.io' }, owner);
		const sam = await signIn('sam@goldenberry.io');

		const before = await h.app.request('/admin/products', {
			headers: { Authorization: `Bearer ${sam}` },
		});
		expect(before.status).toBe(200);

		const team = (await req('GET', '/admin/team', undefined, owner)).body.team as {
			id: number;
			email: string;
		}[];
		const samId = team.find((m) => m.email === 'sam@goldenberry.io')?.id;
		const removed = await req('DELETE', `/admin/team/${samId}`, undefined, owner);
		expect(removed.status).toBe(200);

		const after = await h.app.request('/admin/products', {
			headers: { Authorization: `Bearer ${sam}` },
		});
		expect(after.status).toBe(401);

		// And they can no longer request a fresh code.
		const sent = h.email.sent.length;
		await req('POST', '/auth/request-code', { email: 'sam@goldenberry.io' });
		expect(h.email.sent).toHaveLength(sent);
	});

	it('refuses to remove the last admin, which would lock everyone out', async () => {
		const owner = await signIn('chris@goldenberry.io');
		const team = (await req('GET', '/admin/team', undefined, owner)).body.team as { id: number }[];
		const res = await req('DELETE', `/admin/team/${team[0].id}`, undefined, owner);
		expect(res.status).toBe(409);
		expect(res.body.error).toBe('last_admin');
	});

	it('is reachable with the env admin token so a locked-out team can recover', async () => {
		await signIn('chris@goldenberry.io');
		const res = await h.app.request('/admin/team', { headers: h.adminHeaders });
		expect(res.status).toBe(200);
	});
});
