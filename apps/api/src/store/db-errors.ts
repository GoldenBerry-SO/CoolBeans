// ABOUTME: Database error classification shared by uniqueness-sensitive write paths.
// ABOUTME: Walks wrapped causes so changing Drizzle drivers does not silently disable recovery.

/** Flatten the useful text and error codes from an Error.cause chain. */
function errorDetails(error: unknown): string {
	const details: string[] = [];
	const seen = new Set<unknown>();
	let current: unknown = error;
	while (current && !seen.has(current)) {
		seen.add(current);
		if (current instanceof Error) details.push(current.message);
		if (typeof current === 'object') {
			const value = current as { code?: unknown; cause?: unknown };
			if (typeof value.code === 'string') details.push(value.code);
			current = value.cause;
		} else {
			break;
		}
	}
	return details.join(' ');
}

/** SQLite, libSQL and Postgres all report unique violations differently. */
export function isUniqueConstraintError(error: unknown, identifiers: string[] = []): boolean {
	const details = errorDetails(error);
	const isUnique = /\bUNIQUE\b|SQLITE_CONSTRAINT_UNIQUE|\b23505\b/i.test(details);
	if (!isUnique) return false;
	const normalized = details.toLowerCase();
	return (
		identifiers.length === 0 ||
		identifiers.some((identifier) => normalized.includes(identifier.toLowerCase()))
	);
}
