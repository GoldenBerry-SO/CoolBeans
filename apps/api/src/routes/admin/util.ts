// ABOUTME: Shared helpers for admin routes — JSON body parsing with the uniform error envelope.
// ABOUTME: Keeps validation identical across the admin surface.

import type { Product } from '@coolbeans/db';
import type { Context } from 'hono';
import type { z } from 'zod';
import { badRequest, forbidden, validationError } from '../../http/errors.js';

/**
 * Who to record in the audit log (PRD §16). A magic-code session names the human;
 * the shared env token can only ever be attributed to "the admin token" — never
 * the token value itself, which §19 says is never logged.
 */
export function auditActor(c: Context): string {
	const email = c.get('adminEmail') as string | undefined;
	return email ? `admin:${email}` : 'admin:token';
}

/**
 * The product a per-product token is scoped to, or undefined for a full admin.
 * Handlers call assertScope() before acting on a named product.
 */
export function productScope(c: Context): Product | undefined {
	return c.get('productScope') as Product | undefined;
}

/** Refuse when a scoped token names a product that is not its own. */
export function assertScope(c: Context, product: Product): void {
	const scope = productScope(c);
	if (scope && scope.id !== product.id) {
		throw forbidden('This token is scoped to a different product.');
	}
}

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
