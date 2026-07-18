// ABOUTME: Tests for the CLI client resolution — env/flags and the token-required guard.
// ABOUTME: Command wiring is exercised end-to-end against a live server in the API e2e suite.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveClient } from './client.js';

const saved = { url: process.env.COOLBEANS_URL, token: process.env.COOLBEANS_ADMIN_TOKEN };

beforeEach(() => {
	delete process.env.COOLBEANS_URL;
	delete process.env.COOLBEANS_ADMIN_TOKEN;
});
afterEach(() => {
	if (saved.url === undefined) delete process.env.COOLBEANS_URL;
	else process.env.COOLBEANS_URL = saved.url;
	if (saved.token === undefined) delete process.env.COOLBEANS_ADMIN_TOKEN;
	else process.env.COOLBEANS_ADMIN_TOKEN = saved.token;
});

describe('resolveClient', () => {
	it('prefers flags over env and strips a trailing slash', () => {
		process.env.COOLBEANS_URL = 'http://env:3000';
		const c = resolveClient({ url: 'http://flag:9000/', token: 'tok' });
		expect(c.url).toBe('http://flag:9000');
		expect(c.token).toBe('tok');
	});

	it('falls back to env', () => {
		process.env.COOLBEANS_URL = 'http://env:3000';
		process.env.COOLBEANS_ADMIN_TOKEN = 'envtok';
		const c = resolveClient({});
		expect(c.url).toBe('http://env:3000');
		expect(c.token).toBe('envtok');
	});

	it('throws when no token is available', () => {
		expect(() => resolveClient({})).toThrow(/admin token/i);
	});
});
