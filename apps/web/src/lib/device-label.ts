// ABOUTME: Turns an activation's instance name into something readable (issue #98).
// ABOUTME: SDKs often send a machine fingerprint as the name; a vendor can't tell UUIDs apart.

/**
 * A name that is just hex-and-dashes is a fingerprint, not a name — show a short device
 * handle a human can compare across rows. Anything else is a name the app chose on
 * purpose and passes through untouched.
 */
export function deviceLabel(name: string): string {
	if (!name) return 'Unnamed device';
	const bare = name.replace(/-/g, '');
	if (bare.length >= 16 && /^[0-9a-f]+$/i.test(bare)) {
		return `Device ${name.slice(0, 8).toUpperCase()}`;
	}
	return name;
}
