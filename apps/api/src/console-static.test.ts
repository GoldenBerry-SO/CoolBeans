// ABOUTME: The SPA fallback must never answer for the API — an unknown API path is a JSON
// ABOUTME: 404, not index.html, or a typo'd endpoint looks like a 200 with HTML to a client.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mountConsole } from './console-static.js';
import { makeHarness } from './test/harness.js';

async function harnessWithConsole() {
	const h = await makeHarness();
	const webRoot = mkdtempSync(join(tmpdir(), 'cb-web-'));
	writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>console</title>');
	writeFileSync(join(webRoot, 'logo.png'), 'PNG-BYTES-NOT-HTML');
	mountConsole(h.app, h.deps, webRoot);
	return h;
}

describe('the SPA fallback and the API surface', () => {
	it('serves index.html for client routes', async () => {
		const h = await harnessWithConsole();
		for (const path of ['/', '/licenses', '/billing', '/some/deep/route']) {
			const res = await h.app.request(path);
			expect(res.status).toBe(200);
			expect(await res.text()).toContain('console');
		}
	});

	it('never answers for an unknown API path', async () => {
		// A client that typos an endpoint must get a machine-readable 404, not a 200 full
		// of HTML. Discovered live: GET /v1/nonexistent returned the console.
		const h = await harnessWithConsole();
		// /admin answers 401 rather than 404: auth runs before routing, which is right —
		// an unauthenticated probe learns nothing about which admin paths exist. The
		// invariant here is narrower and absolute: the API surface never speaks HTML.
		const expected: Record<string, number> = {
			'/v1/nonexistent': 404,
			'/admin/nonexistent': 401,
			'/auth/nonexistent': 404,
			// The bare roots too — Codex caught that slash-terminated prefixes miss them,
			// and a bare GET /v1 is the single most plausible mistyped API URL there is.
			'/v1': 404,
			'/admin': 401,
			'/auth': 404,
		};
		for (const [path, status] of Object.entries(expected)) {
			const res = await h.app.request(path);
			expect(res.status, path).toBe(status);
			expect(res.headers.get('content-type'), path).not.toContain('text/html');
		}
	});

	it('serves a real root asset as itself, not the SPA', async () => {
		// The email templates point at PUBLIC_URL/logo.png. If the static serve missed root
		// files, that URL would return the console HTML and every email logo would break.
		const h = await harnessWithConsole();
		const res = await h.app.request('/logo.png');
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toBe('PNG-BYTES-NOT-HTML');
		expect(body).not.toContain('<!doctype html');
	});

	it('leaves real API routes exactly as they are', async () => {
		const h = await harnessWithConsole();
		const res = await h.app.request('/health');
		expect(await res.json()).toMatchObject({ ok: true });
	});
});
