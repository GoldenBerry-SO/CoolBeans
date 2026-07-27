// ABOUTME: The --entitlements flag (#80 follow-up) — JSON in, the flat scalar map out, or a loud no.
// ABOUTME: These end up signed into every token the key issues, so a typo must never half-work.

import { describe, expect, it } from 'vitest';
import { parseEntitlementsFlag } from './entitlements-flag.js';

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
