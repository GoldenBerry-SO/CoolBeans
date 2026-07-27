// ABOUTME: Parse the --entitlements flag: a JSON object of flat scalars, or a loud refusal.
// ABOUTME: These are signed into every token the key issues, so a typo must never half-work.

/**
 * JSON rather than the console's `name=value` shorthand, because a CLI argument already lives
 * inside shell quoting and a second mini-syntax on top of that is where mistakes hide. The
 * server validates names and sizes again; this catches the shape early with a usable message.
 */
export function parseEntitlementsFlag(raw: string): Record<string, boolean | number | string> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(
			`--entitlements must be a JSON object, e.g. '{"export_4k":true,"batch_limit":100}'.`,
		);
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('--entitlements must be a JSON object, not an array or a bare value.');
	}
	for (const [name, value] of Object.entries(parsed)) {
		if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') {
			throw new Error(
				`--entitlements must be flat: "${name}" is ${value === null ? 'null' : typeof value}, and only booleans, numbers and strings are capabilities.`,
			);
		}
	}
	return parsed as Record<string, boolean | number | string>;
}

/**
 * Parse --seats: a positive integer the API can store, or a message that points at the typo.
 *
 * Digits-only is not enough: 1 with 400 zeroes is Infinity, and JSON.stringify turns Infinity
 * into null — recreating exactly the invalid request this flag exists to stop, with more digits.
 * The upper bound matches the API's int4 column, so a value valid here cannot 422 over there.
 */
export function parseSeatsFlag(raw: string): number {
	const value = Number(raw);
	if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
		throw new Error(`--seats must be a positive integer up to 2147483647, got "${raw}".`);
	}
	return value;
}
