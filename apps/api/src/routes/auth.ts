// ABOUTME: Console auth routes — request a magic code, verify it, sign out (PRD §16, design v2).
// ABOUTME: request-code always answers success so the endpoint never reveals whether an email exists.

import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppDeps } from '../deps.js';
import { badRequest, unauthorized } from '../http/errors.js';
import { requestCode, revokeSession, verifyCode } from '../services/console-auth.js';

const requestBody = z.object({ email: z.string().email() });
const verifyBody = z.object({
	email: z.string().email(),
	code: z.string().regex(/^\d{6}$/, 'The code is six digits.'),
	name: z.string().min(1).max(80).optional(),
});

async function readBody<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>) {
	let raw: unknown;
	try {
		raw = await c.req.json();
	} catch {
		throw badRequest('Request body must be valid JSON.');
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body.');
	return parsed.data;
}

export function registerAuthRoutes(app: OpenAPIHono, deps: AppDeps): void {
	app.post('/auth/request-code', async (c) => {
		const body = await readBody(c, requestBody);
		await requestCode(deps, body.email);
		// Uniform response: whether or not anything was sent, the answer is the same.
		return c.json({ ok: true, message: 'If that email can sign in, a code is on its way.' });
	});

	app.post('/auth/verify', async (c) => {
		const body = await readBody(c, verifyBody);
		const result = verifyCode(deps, body.email, body.code, body.name);
		if (!result) throw unauthorized();
		return c.json({ ok: true, token: result.token, admin: result.admin });
	});

	app.post('/auth/signout', async (c) => {
		const header = c.req.header('Authorization') ?? '';
		if (header.startsWith('Bearer ')) revokeSession(deps, header.slice('Bearer '.length));
		return c.json({ ok: true });
	});
}
