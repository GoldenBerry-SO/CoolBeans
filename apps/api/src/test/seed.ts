// ABOUTME: Test seed helpers — create products and issue keys through the real admin API.
// ABOUTME: Fixtures never write the DB directly, so tests exercise the same path production does.

import type { App } from '../app.js';

const ADMIN = {
	Authorization: 'Bearer test-admin-token-0123456789',
	'Content-Type': 'application/json',
};

export async function createProduct(
	app: App,
	body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const res = await app.request('/admin/products', {
		method: 'POST',
		headers: ADMIN,
		body: JSON.stringify(body),
	});
	if (res.status !== 200)
		throw new Error(`createProduct failed: ${res.status} ${await res.text()}`);
	return ((await res.json()) as { product: Record<string, unknown> }).product;
}

export async function issueKey(
	app: App,
	body: { product: string; email: string; tier: string; trial_days?: number; expires_at?: string },
): Promise<string> {
	const res = await app.request('/admin/keys', {
		method: 'POST',
		headers: ADMIN,
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

export async function post(app: App, path: string, body: unknown) {
	const res = await app.request(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
