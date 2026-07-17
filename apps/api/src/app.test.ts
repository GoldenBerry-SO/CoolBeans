// ABOUTME: Tests for the app composition root — health check and OpenAPI document.
// ABOUTME: Drives the app via Hono's fetch harness (app.request), no HTTP server needed.

import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('createApp', () => {
	it('responds ok on /health', async () => {
		const app = createApp();
		const res = await app.request('/health');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, status: 'ok' });
	});

	it('serves an OpenAPI document on /doc', async () => {
		const app = createApp();
		const res = await app.request('/doc');
		expect(res.status).toBe(200);
		const doc = (await res.json()) as { openapi: string; info: { title: string } };
		expect(doc.openapi).toBe('3.1.0');
		expect(doc.info.title).toBe('Cool Beans API');
	});
});
