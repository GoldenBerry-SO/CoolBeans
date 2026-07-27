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
