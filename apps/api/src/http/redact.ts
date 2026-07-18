// ABOUTME: Log redaction (PRD §19) — the license key is the credential and must never be logged.
// ABOUTME: Strips query strings and masks key-shaped path segments before a line reaches the logger.

// A display key (CLEM-XXXX-XXXX-XXXX-XXXX) or normalized key (prefix + 16 body chars).
const DISPLAY_KEY = /\b[A-Z]{2,12}(?:-[A-Z0-9]{4}){4}\b/g;
const NORMALIZED_KEY = /\b[A-Z]{2,12}[ABCDEFGHJKMNPQRSTVWXYZ23456789]{16}\b/g;

/** Redact credentials from a request-log line: drop query params, mask key-shaped tokens. */
export function redactLogLine(line: string): string {
	return line
		.replace(/\?[^\s]*/g, '?[REDACTED]')
		.replace(DISPLAY_KEY, '[KEY]')
		.replace(NORMALIZED_KEY, '[KEY]');
}
