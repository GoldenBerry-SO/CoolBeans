// ABOUTME: Test seed helpers — create products and issue keys through the real admin API.
// ABOUTME: Fixtures never write the DB directly, except seedGrant (internal pricing config).

import { licenseGrants } from '@coolbeans/db';
import type { App } from '../app.js';
import type { AppDeps } from '../deps.js';
import { SELF_HOST_CONNECTION_ID } from '../store/grants.js';

/**
 * Map a Stripe price to a product on the self-host connection, as `beans stripe connect`
 * would. A direct insert (not an endpoint) so a test can wire one price without a full
 * two-price connect + a live gateway.
 */
export async function seedGrant(
	deps: AppDeps,
	args: {
		productId: number;
		priceId: string;
		kind: 'perpetual' | 'subscription';
		plan?: string | null;
		accountId?: number;
		/** Defaults to the self-host connection; a cloud isolation test passes its own. */
		connectionId?: number;
		/** Seats this price buys; null inherits the product's limit. */
		activationLimit?: number | null;
	},
): Promise<void> {
	await deps.db.insert(licenseGrants).values({
		accountId: args.accountId ?? 1,
		stripeConnectionId: args.connectionId ?? SELF_HOST_CONNECTION_ID,
		stripePriceId: args.priceId,
		productId: args.productId,
		kind: args.kind,
		plan: args.plan ?? null,
		activationLimit: args.activationLimit ?? null,
		status: 'active',
	});
}

const ADMIN = {
	Authorization: 'Bearer test-admin-token-0123456789',
	'Content-Type': 'application/json',
};

export async function createProduct(
	app: App,
	body: Record<string, unknown>,
	// Defaults to the instance admin token, which is what every single-account test wants.
	// Multi-account tests pass a session's headers instead.
	headers: Record<string, string> = ADMIN,
): Promise<Record<string, unknown>> {
	const res = await app.request('/admin/products', {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	});
	if (res.status !== 200)
		throw new Error(`createProduct failed: ${res.status} ${await res.text()}`);
	return ((await res.json()) as { product: Record<string, unknown> }).product;
}

export async function issueKey(
	app: App,
	body: { product: string; email: string; kind: string; trial_days?: number; expires_at?: string },
	headers: Record<string, string> = ADMIN,
): Promise<string> {
	const res = await app.request('/admin/keys', {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	});
	if (res.status !== 200) throw new Error(`issueKey failed: ${res.status} ${await res.text()}`);
	return ((await res.json()) as { key: string }).key;
}

export async function defineMetric(
	app: App,
	slug: string,
	body: { key: string; display_name: string; default_limit?: number; reset_period?: string },
): Promise<void> {
	const res = await app.request(`/admin/products/${slug}/metrics`, {
		method: 'POST',
		headers: ADMIN,
		body: JSON.stringify(body),
	});
	if (res.status !== 200) throw new Error(`defineMetric failed: ${res.status} ${await res.text()}`);
}

/**
 * Sign up through the real magic-code flow and return that account's request headers.
 *
 * Needs a harness with billing configured (which is what puts the instance in cloud mode
 * and opens signup) and logMagicCodes on, since the code is read back off the logger the
 * same way a developer reads it locally.
 */
export async function signUp(
	app: App,
	logger: { lines: { message: string; fields?: Record<string, unknown> }[] },
	email: string,
	accountName?: string,
): Promise<Record<string, string>> {
	const asked = await app.request('/auth/request-code', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email }),
	});
	if (asked.status !== 200) throw new Error(`request-code failed: ${asked.status}`);
	const line = [...logger.lines].reverse().find((l) => l.fields?.email === email);
	const code = line?.fields?.code as string | undefined;
	if (!code) throw new Error(`no magic code logged for ${email} (is logMagicCodes on?)`);

	const verified = await app.request('/auth/verify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, code, ...(accountName ? { account_name: accountName } : {}) }),
	});
	if (verified.status !== 200)
		throw new Error(`verify failed: ${verified.status} ${await verified.text()}`);
	const { token } = (await verified.json()) as { token: string };
	return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function post(app: App, path: string, body: unknown) {
	const res = await app.request(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
