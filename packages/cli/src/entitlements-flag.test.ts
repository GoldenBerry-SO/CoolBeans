// ABOUTME: The --entitlements flag (#80 follow-up) — JSON in, the flat scalar map out, or a loud no.
// ABOUTME: These end up signed into every token the key issues, so a typo must never half-work.

import { describe, expect, it } from 'vitest';
import { parseEntitlementsFlag, parseSeatsFlag } from './entitlements-flag.js';

describe('parseEntitlementsFlag', () => {
	it('accepts a flat JSON object of scalars', () => {
		expect(parseEntitlementsFlag('{"export_4k":true,"batch_limit":100,"tier":"gold"}')).toEqual({
			export_4k: true,
			batch_limit: 100,
			tier: 'gold',
		});
	});

	it('refuses non-JSON with a message naming the flag', () => {
		expect(() => parseEntitlementsFlag('export_4k, batch_limit=100')).toThrow(/--entitlements/);
	});

	it('refuses nested shapes, arrays and null values', () => {
		expect(() => parseEntitlementsFlag('{"limits":{"batch":10}}')).toThrow(/flat/i);
		expect(() => parseEntitlementsFlag('[1,2]')).toThrow(/object/i);
		expect(() => parseEntitlementsFlag('{"a":null}')).toThrow(/flat/i);
	});
});

describe('parseSeatsFlag', () => {
	it('accepts a positive integer', () => {
		expect(parseSeatsFlag('10')).toBe(10);
	});

	it('refuses anything else by name, instead of sending NaN as null', () => {
		expect(() => parseSeatsFlag('abc')).toThrow(/--seats/);
		expect(() => parseSeatsFlag('0')).toThrow(/--seats/);
		expect(() => parseSeatsFlag('1.5')).toThrow(/--seats/);
	});

	it('refuses a number JSON cannot carry, which was the original bug wearing more digits', () => {
		// Digits-only passes a regex, but 1 with 400 zeroes is Infinity, and JSON.stringify turns
		// Infinity into null — recreating exactly the invalid request this flag exists to stop.
		expect(() => parseSeatsFlag(`1${'0'.repeat(400)}`)).toThrow(/--seats/);
		// And the API's int4 bound applies here too, or a valid-here value 422s over there.
		expect(() => parseSeatsFlag('2147483648')).toThrow(/--seats/);
		expect(parseSeatsFlag('2147483647')).toBe(2_147_483_647);
	});
});
