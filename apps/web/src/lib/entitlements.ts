// ABOUTME: Parse the console's entitlements field (#76) into the flat scalar map the API stores.
// ABOUTME: `export_4k, batch_limit=100` is what a vendor types; a signed capability map is what apps read.

export type EntitlementMap = Record<string, boolean | number | string>;

export interface ParsedEntitlements {
	/** Undefined when the field is empty, which means "leave what this price already grants". */
	values?: EntitlementMap;
	error?: string;
}

/** What an app can safely write as `state.entitlements.export_4k`, and nothing that looks nested. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Read `key=value` entries, separated by commas or newlines. A bare name means true, since "this
 * price includes 4k export" is the common case and `=true` adds nothing. Values that read as
 * numbers or booleans become those; everything else stays a string.
 *
 * Returns an error rather than guessing: these end up signed into every token the price issues,
 * so a typo silently becoming a capability nobody meant to sell is the wrong failure.
 */
export function parseEntitlements(input: string): ParsedEntitlements {
	const entries = input
		.split(/[,\n]/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	if (entries.length === 0) return { values: undefined };

	const values: EntitlementMap = {};
	for (const entry of entries) {
		const split = entry.indexOf('=');
		const name = (split === -1 ? entry : entry.slice(0, split)).trim();
		if (!name) return { error: `"${entry}" has no name. Write it as name=value.` };
		if (!NAME.test(name)) {
			return {
				error: `"${name}" is not a valid name. Use letters, numbers and underscores, starting with a letter.`,
			};
		}
		if (name in values) return { error: `"${name}" is listed twice.` };
		if (split === -1) {
			values[name] = true;
			continue;
		}
		const raw = entry.slice(split + 1).trim();
		if (!raw) {
			// The empty string is the worst reading of a slip: falsy, so the capability is off,
			// while the vendor sees it listed and assumes it is on. Write the name alone for true.
			return { error: `"${name}" has no value. Write "${name}" on its own to switch it on.` };
		}
		values[name] = readValue(raw);
	}
	return { values };
}

/** Never called with an empty string: the caller refuses those rather than guessing. */
function readValue(raw: string): boolean | number | string {
	if (raw === 'true') return true;
	if (raw === 'false') return false;
	if (Number.isFinite(Number(raw))) return Number(raw);
	return raw;
}

/** Render a stored map back into the field's syntax, for showing what a price already grants. */
export function formatEntitlements(values: EntitlementMap | null | undefined): string {
	if (!values) return '';
	return Object.entries(values)
		.map(([name, value]) => (value === true ? name : `${name}=${value}`))
		.join(', ');
}

/**
 * What to send as the grant's `entitlements`, keeping the API's three states apart.
 *
 * Undefined keeps what the price already grants, an empty map clears them, and a map replaces
 * them. The console has to be able to reach all three: without the clear, taking a capability off
 * a price means retiring the mapping or reaching for curl.
 *
 * `clear` wins over any text, because the field is hidden while it is ticked and whatever is behind
 * it is stale rather than intent. Text that does not parse sends nothing, so a typo can never be
 * read as a clear — the caller shows the parse error instead.
 */
export function entitlementsPayload(text: string, clear: boolean): EntitlementMap | undefined {
	if (clear) return {};
	return parseEntitlements(text).values;
}
