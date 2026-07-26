// ABOUTME: The entitlements field's parser (#76) — `key=value` lines a vendor types in the console
// ABOUTME: become the flat scalar map the API signs into every token this price issues.

import { describe, expect, it } from 'vitest';
import { parseEntitlements } from './entitlements.js';

describe('parseEntitlements', () => {
	it('reads a bare name as a capability that is switched on', () => {
		// The common case by far: "this price includes 4k export". Making a vendor type `=true`
		// for it buys nothing.
		expect(parseEntitlements('export_4k')).toEqual({ values: { export_4k: true } });
	});

	it('reads numbers as numbers and true/false as booleans', () => {
		expect(parseEntitlements('export_4k=true, batch_limit=100, beta=false')).toEqual({
			values: { export_4k: true, batch_limit: 100, beta: false },
		});
	});

	it('keeps anything else as a string, spaces and all', () => {
		expect(parseEntitlements('tier=gold plated')).toEqual({ values: { tier: 'gold plated' } });
	});

	it('accepts one per line as well as comma separated', () => {
		expect(parseEntitlements('export_4k\nbatch_limit = 10\n')).toEqual({
			values: { export_4k: true, batch_limit: 10 },
		});
	});

	it('treats an empty field as nothing to say, not as clearing them', () => {
		// Omitting the field keeps whatever the price already grants, so blank must not send an
		// empty map and quietly strip capabilities customers are paying for.
		expect(parseEntitlements('')).toEqual({ values: undefined });
		expect(parseEntitlements('  \n ')).toEqual({ values: undefined });
	});

	it('refuses a name with no value after the equals', () => {
		// `export_4k=` is a slip, and reading it as the empty string is the worst outcome: the value
		// is falsy, so the capability is off, and the vendor sees it listed and assumes it is on.
		expect(parseEntitlements('export_4k=').error).toBeTruthy();
		expect(parseEntitlements('a=1, b=').error).toMatch(/b/);
	});

	it('refuses a nameless value', () => {
		expect(parseEntitlements('=100').error).toMatch(/name/i);
	});

	it('refuses the same name twice, rather than silently keeping one', () => {
		expect(parseEntitlements('seats=1, seats=2').error).toMatch(/seats/);
	});

	it('refuses a name that is not a plain identifier', () => {
		// An app reads these as `state.entitlements.export_4k`, so a name with a dot or a space
		// in it is a trap: it looks like a nested path and is not one.
		expect(parseEntitlements('limits.batch=10').error).toBeTruthy();
	});
});
