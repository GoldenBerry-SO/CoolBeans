// ABOUTME: Tests the admin bearer compare, including the case where no admin token is configured.
// ABOUTME: The hosted deployment leaves ADMIN_TOKEN unset, so "unset" must mean "nobody matches".

import { describe, expect, it } from 'vitest';
import { isAdminRequest, safeEqual } from './admin-auth.js';

describe('admin bearer auth', () => {
	it('matches the configured token', async () => {
		expect(isAdminRequest('Bearer secret-token-value', 'secret-token-value')).toBe(true);
	});

	it.each([
		['wrong token', 'Bearer nope', 'secret-token-value'],
		['no bearer prefix', 'secret-token-value', 'secret-token-value'],
		['no header', undefined, 'secret-token-value'],
	])('rejects %s', (_label, header, token) => {
		expect(isAdminRequest(header, token)).toBe(false);
	});

	it.each(['Bearer ', 'Bearer anything', 'Bearer undefined', ''])(
		'never matches %p when no admin token is configured',
		(header) => {
			// Cloud runs with ADMIN_TOKEN unset so the global bypass does not exist there.
			// Comparing against an empty string instead would hand god-mode to anyone
			// sending an empty bearer.
			expect(isAdminRequest(header, undefined)).toBe(false);
			expect(isAdminRequest(header, '')).toBe(false);
		},
	);

	it('compares equal-length and different-length values without throwing', async () => {
		expect(safeEqual('a', 'a')).toBe(true);
		expect(safeEqual('a', 'a-much-longer-value')).toBe(false);
	});
});
