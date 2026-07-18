// ABOUTME: Shared helpers for admin routes — JSON body parsing with the uniform error envelope.
// ABOUTME: Keeps validation identical across the admin surface.

import type { Context } from 'hono';
import type { z } from 'zod';
import { badRequest, validationError } from '../../http/errors.js';

export async function readBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
	let raw: unknown;
	try {
		raw = await c.req.json();
	} catch {
		throw badRequest('Request body must be valid JSON.');
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw validationError(
			issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request body.',
		);
	}
	return parsed.data;
}
