// ABOUTME: Checkout correlation accepts only a namespaced random UUID, never arbitrary provider reference text.
// ABOUTME: Missing or malformed references stay unlinked without blocking a paid licence's issuance.
import { describe, expect, it } from 'vitest';
import { checkoutAttemptId } from './checkout-reference.js';

describe('checkout attempt reference', () => {
	it('normalizes a namespaced UUID without accepting general client reference text', () => {
		const ref = 'gb_checkout_12345678-1234-4234-8234-123456789abc';
		expect(checkoutAttemptId(ref)).toBe(ref);
		expect(checkoutAttemptId(ref.toUpperCase())).toBe(ref);
	});
	it('ignores legacy references, private content and malformed values', () => {
		for (const value of [
			null,
			undefined,
			7,
			{},
			'',
			'buyer@example.com',
			'TG-PRIVATE-KEY',
			'12345678-1234-4234-8234-123456789abc',
			'gb_checkout_12345678-1234-1234-8234-123456789abc',
			'gb_checkout_12345678-1234-4234-8234-123456789abc-extra',
			'gb_checkout_12345678-1234-4234-8234-123456789abc\n',
		]) {
			expect(checkoutAttemptId(value)).toBeNull();
		}
	});
});
