// ABOUTME: Console API client regressions — expired admin sessions must recover to sign-in.
// ABOUTME: A stored token can outlive an ADMIN_TOKEN rotation, so a 401 clears and broadcasts it.

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('admin API authentication', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('clears the stored token and broadcasts when an admin request returns 401', async () => {
		const values = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
		});
		const dispatchEvent = vi.fn();
		vi.stubGlobal('window', { dispatchEvent });
		const unauthorized = new Response(
			JSON.stringify({ ok: false, error: 'unauthorized', message: 'Expired' }),
			{ status: 401, headers: { 'Content-Type': 'application/json' } },
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(unauthorized)),
		);

		const { api, AUTH_INVALID_EVENT, getToken, setToken } = await import('./api.js');
		setToken('stale-token');

		await expect(api('GET', '/admin/stats')).rejects.toMatchObject({ status: 401 });

		expect(getToken()).toBeNull();
		expect(dispatchEvent).toHaveBeenCalledOnce();
		expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({ type: AUTH_INVALID_EVENT });
	});
});
