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
		values[name] = split === -1 ? true : readValue(entry.slice(split + 1).trim());
	}
	return { values };
}

function readValue(raw: string): boolean | number | string {
	if (raw === 'true') return true;
	if (raw === 'false') return false;
	// Number('') is 0, which would turn `seats=` into a real limit of zero.
	if (raw.length > 0 && Number.isFinite(Number(raw))) return Number(raw);
	return raw;
}

/** Render a stored map back into the field's syntax, for showing what a price already grants. */
export function formatEntitlements(values: EntitlementMap | null | undefined): string {
	if (!values) return '';
	return Object.entries(values)
		.map(([name, value]) => (value === true ? name : `${name}=${value}`))
		.join(', ');
}
