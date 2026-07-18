// ABOUTME: Tests for the app composition root — health check and OpenAPI document.
// ABOUTME: Drives the app via Hono's fetch harness (app.request), no HTTP server needed.

import { describe, expect, it } from 'vitest';
import { makeHarness } from './test/harness.js';

describe('createApp', () => {
	it('responds ok on /health', async () => {
		const { app } = makeHarness();
		const res = await app.request('/health');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, status: 'ok' });
	});

	it('serves an OpenAPI document on /doc', async () => {
		const { app } = makeHarness();
		const res = await app.request('/doc');
		expect(res.status).toBe(200);
		const doc = (await res.json()) as { openapi: string; info: { title: string } };
		expect(doc.openapi).toBe('3.1.0');
		expect(doc.info.title).toBe('Cool Beans API');
	});
});

describe('OpenAPI document (issue #48)', () => {
	it('describes the frozen public contract instead of advertising nothing', async () => {
		const h = makeHarness();
		const res = await h.app.request('/doc');
		const doc = (await res.json()) as { paths: Record<string, unknown> };
		expect(Object.keys(doc.paths ?? {}).sort()).toEqual([
			'/v1/activate',
			'/v1/deactivate',
			'/v1/heartbeat',
			'/v1/pubkey',
			'/v1/usage',
			'/v1/usage/increment',
			'/v1/validate',
		]);
	});

	it('never documents a path that is not actually served', async () => {
		const h = makeHarness();
		const res = await h.app.request('/doc');
		const doc = (await res.json()) as {
			paths: Record<string, Record<string, unknown>>;
		};
		for (const [path, methods] of Object.entries(doc.paths)) {
			for (const method of Object.keys(methods)) {
				const probe = await h.app.request(path, {
					method: method.toUpperCase(),
					headers: { 'Content-Type': 'application/json' },
					...(method === 'get' ? {} : { body: '{}' }),
				});
				// A documented path must be served. The request itself is expected to be
				// rejected for missing fields, so any handled status proves the route exists;
				// an unrouted path would fall through to Hono's bare 404 with no envelope.
				expect([200, 400, 401, 404, 422, 429]).toContain(probe.status);
				if (probe.status === 404) {
					const body = (await probe.json()) as { error?: string };
					expect(body.error).toBeTruthy();
				}
			}
		}
	});
});
