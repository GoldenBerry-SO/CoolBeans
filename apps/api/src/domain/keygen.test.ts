// ABOUTME: Exhaustive tests for key generation and normalization (PRD §10).
// ABOUTME: Covers format, alphabet, distribution/no-bias, and the reject-malformed-before-storage rule.

import { describe, expect, it } from 'vitest';
import {
	ALPHABET,
	generateKey,
	generateKeyBody,
	isValidKey,
	normalizedKey,
	parseKey,
} from './keygen.js';

describe('generateKey', () => {
	it('produces a PREFIX-grouped key with a 16-char body (PRD §10, 78 bits)', () => {
		const key = generateKey('CLEM');
		expect(key).toMatch(/^CLEM-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
		expect(key.replace(/[-]/g, '').slice(4)).toHaveLength(16);
	});

	it('uppercases the prefix', () => {
		expect(generateKey('clem').startsWith('CLEM-')).toBe(true);
	});

	it('only uses alphabet characters (no ambiguous I L O U 0 1)', () => {
		for (let i = 0; i < 200; i++) {
			const body = generateKeyBody();
			expect(body).toHaveLength(16);
			for (const ch of body) expect(ALPHABET).toContain(ch);
		}
	});

	it('is effectively unique across many draws', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 5000; i++) seen.add(generateKeyBody());
		expect(seen.size).toBe(5000);
	});

	it('draws each alphabet symbol with no gross bias', () => {
		const counts = new Map<string, number>();
		const draws = 2000;
		for (let i = 0; i < draws; i++) {
			for (const ch of generateKeyBody()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
		}
		const total = draws * 16;
		const expected = total / ALPHABET.length;
		// Every symbol should appear; none should deviate wildly (±40% band is generous).
		for (const ch of ALPHABET) {
			const c = counts.get(ch) ?? 0;
			expect(c).toBeGreaterThan(expected * 0.6);
			expect(c).toBeLessThan(expected * 1.4);
		}
	});
});

describe('parseKey / normalization', () => {
	it('round-trips display format to stored format', () => {
		const parsed = parseKey('CLEM-A2B3-C4D5-E6F7-G8H9', 'CLEM');
		expect(parsed?.normalized).toBe('CLEMA2B3C4D5E6F7G8H9');
		expect(parsed?.body).toBe('A2B3C4D5E6F7G8H9');
	});

	it('normalizes whitespace, lowercase, and stray dashes', () => {
		expect(parseKey('  clem-a2b3c4d5-e6f7g8h9  ', 'CLEM')?.normalized).toBe('CLEMA2B3C4D5E6F7G8H9');
	});

	it('rejects the wrong prefix', () => {
		expect(parseKey('HEX-A2B3-C4D5-E6F7', 'CLEM')).toBeNull();
	});

	it('rejects the wrong length', () => {
		expect(parseKey('CLEM-A2B3-C4D5-E6F', 'CLEM')).toBeNull();
		expect(parseKey('CLEM-A2B3-C4D5-E6F7-G8H98', 'CLEM')).toBeNull();
	});

	it('rejects excluded ambiguous characters', () => {
		for (const bad of ['I', 'L', 'O', 'U', '0', '1']) {
			const body = `${bad}2B3C4D5E6F7G8H9`.slice(0, 16);
			expect(parseKey(`CLEM${body}`, 'CLEM')).toBeNull();
		}
	});

	it('accepts a freshly generated key', () => {
		expect(isValidKey(generateKey('CLEM'), 'CLEM')).toBe(true);
	});

	it('normalizedKey composes prefix and body', () => {
		expect(normalizedKey('clem', 'A2B3C4D5E6F7G8H9')).toBe('CLEMA2B3C4D5E6F7G8H9');
	});
});
