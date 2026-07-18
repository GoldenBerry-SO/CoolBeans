// ABOUTME: License key generation and normalization (PRD §10) — pure, no I/O.
// ABOUTME: Format <PREFIX>-XXXX-XXXX-XXXX; the shared normalizer is the gate before any storage hit.

import { webcrypto } from 'node:crypto';

// A–Z and 2–9, minus the ambiguous I, L, O, U, 0, 1. 30 symbols.
export const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const KEY_BODY_LENGTH = 16;
const ALPHABET_SET = new Set(ALPHABET);

/**
 * Draw `count` symbols from ALPHABET using rejection sampling so there is no modulo
 * bias: we reject any random byte at or above the largest multiple of the alphabet size.
 */
function drawSymbols(count: number): string {
	const size = ALPHABET.length;
	const maxUnbiased = Math.floor(256 / size) * size;
	let out = '';
	const buf = new Uint8Array(count * 2);
	while (out.length < count) {
		webcrypto.getRandomValues(buf);
		for (const byte of buf) {
			if (byte < maxUnbiased) {
				out += ALPHABET[byte % size];
				if (out.length === count) break;
			}
		}
	}
	return out;
}

/** Generate a normalized key body (16 alphabet chars, no prefix, no dashes). */
export function generateKeyBody(): string {
	return drawSymbols(KEY_BODY_LENGTH);
}

/** Generate a full display key: `<PREFIX>-XXXX-XXXX-XXXX`. */
export function generateKey(prefix: string): string {
	const body = generateKeyBody();
	const groups = [body.slice(0, 4), body.slice(4, 8), body.slice(8, 12), body.slice(12, 16)];
	return `${prefix.toUpperCase()}-${groups.join('-')}`;
}

/** The stored, canonical form of a key: prefix + 16 body chars, uppercase, no dashes. */
export function normalizedKey(prefix: string, body: string): string {
	return `${prefix.toUpperCase()}${body}`;
}

/**
 * Render a stored normalized key back to display form: `<PREFIX>-XXXX-XXXX-XXXX-XXXX`.
 * The prefix can be any length; the 16-char body is grouped into fours.
 */
export function toDisplayKey(normalized: string, prefix: string): string {
	const upperPrefix = prefix.toUpperCase();
	const body = normalized.toUpperCase().slice(upperPrefix.length);
	const groups = body.match(/.{1,4}/g) ?? [];
	return [upperPrefix, ...groups].join('-');
}

export interface ParsedKey {
	prefix: string;
	body: string;
	/** Normalized form used everywhere in storage. */
	normalized: string;
}

/**
 * Strip dashes/whitespace, uppercase, then check `<prefix>` + exactly 16 alphabet chars.
 * Returns null if the input is malformed for this prefix — callers reject before storage.
 */
export function parseKey(input: string, prefix: string): ParsedKey | null {
	if (typeof input !== 'string') return null;
	const cleaned = input.replace(/[\s-]/g, '').toUpperCase();
	const upperPrefix = prefix.toUpperCase();
	if (!cleaned.startsWith(upperPrefix)) return null;
	const body = cleaned.slice(upperPrefix.length);
	if (body.length !== KEY_BODY_LENGTH) return null;
	for (const ch of body) {
		if (!ALPHABET_SET.has(ch)) return null;
	}
	return { prefix: upperPrefix, body, normalized: cleaned };
}

/** True if the input is a well-formed key for the given prefix. */
export function isValidKey(input: string, prefix: string): boolean {
	return parseKey(input, prefix) !== null;
}

/**
 * Cheap syntactic gate (PRD §10, §19): can this input possibly be a key for ANY prefix?
 * Rejects malformed floods before any storage work — letters-only prefix (2–12 chars)
 * followed by exactly 16 alphabet characters.
 */
export function looksLikeKey(input: string): boolean {
	if (typeof input !== 'string' || input.length > 64) return false;
	const cleaned = input.replace(/[\s-]/g, '').toUpperCase();
	if (cleaned.length < 2 + KEY_BODY_LENGTH || cleaned.length > 12 + KEY_BODY_LENGTH) return false;
	if (!/^[A-Z]+[A-Z0-9]+$/.test(cleaned)) return false;
	const body = cleaned.slice(-KEY_BODY_LENGTH);
	for (const ch of body) {
		if (!ALPHABET_SET.has(ch)) return false;
	}
	return true;
}

/**
 * Normalize a key without knowing its product prefix (any of the given prefixes).
 * Used at the public edge where the product is resolved from the prefix.
 */
export function normalizeAgainst(input: string, prefixes: string[]): ParsedKey | null {
	for (const prefix of prefixes) {
		const parsed = parseKey(input, prefix);
		if (parsed) return parsed;
	}
	return null;
}
