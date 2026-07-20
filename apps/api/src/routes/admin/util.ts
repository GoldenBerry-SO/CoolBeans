// ABOUTME: Shared helpers for admin routes — JSON body parsing with the uniform error envelope.
// ABOUTME: Keeps validation identical across the admin surface.

import type { Account, Product } from '@coolbeans/db';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { badRequest, forbidden, notFound, validationError } from '../../http/errors.js';
import { getAccountProductBySlug } from '../../store/products.js';

/**
 * Who to record in the audit log (PRD §16). A magic-code session names the human;
 * the shared env token can only ever be attributed to "the admin token" — never
 * the token value itself, which §19 says is never logged.
 */
export function auditActor(c: Context): string {
	const email = adminEmail(c);
	return email ? `admin:${email}` : 'admin:token';
}

/** The signed-in human's email, or undefined for a token credential. */
export function adminEmail(c: Context): string | undefined {
	return c.get('adminEmail') as string | undefined;
}

/**
 * The product a per-product token is scoped to, or undefined for a full admin.
 * Handlers call assertScope() before acting on a named product.
 */
export function productScope(c: Context): Product | undefined {
	return c.get('productScope') as Product | undefined;
}

/**
 * True for a self-host ADMIN_TOKEN request: no signed-in human and no product token.
 * Such a caller is the operator of the whole instance, so it is the only one shown
 * instance-level rows that belong to no account.
 */
export function isInstanceToken(c: Context): boolean {
	return !adminEmail(c) && !productScope(c);
}

/** Refuse when a scoped token names a product that is not its own. */
export function assertScope(c: Context, product: Product): void {
	const scope = productScope(c);
	if (scope && scope.id !== product.id) {
		throw forbidden('This token is scoped to a different product.');
	}
}

/**
 * The account this request acts inside. consoleAuth sets it on every credential path, so
 * inside /admin it is always present; throwing here means the middleware was bypassed.
 */
export function accountScope(c: Context): Account {
	const account = c.get('accountScope') as Account | undefined;
	if (!account) throw new Error('accountScope is unset: consoleAuth did not run on this route.');
	return account;
}

/**
 * Resolve a :slug within the caller's account, or 404.
 *
 * Cross-account is deliberately 404 and never 403: a 403 would confirm that the slug
 * exists in somebody else's account, which turns this endpoint into a way to enumerate
 * other tenants' products. "Not found" is the honest answer to "your account has no
 * product by that name".
 */
export async function requireProduct(
	c: Context,
	deps: Pick<AppDeps, 'db'>,
	slug: string,
): Promise<Product> {
	const product = await getAccountProductBySlug(deps.db, accountScope(c).id, slug);
	if (!product) throw notFound('No product with that slug.');
	assertScope(c, product);
	return product;
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
