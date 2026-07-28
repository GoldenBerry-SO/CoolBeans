// ABOUTME: Shared date formatting (issue #94) — the console never shows a raw ISO timestamp.
// ABOUTME: formatDate for calendar facts (expiry), formatDateTime where the moment matters.

/** "Jul 28, 2026" in the viewer's locale; an em dash for nothing. */
export function formatDate(iso: string | null | undefined): string {
	if (!iso) return '—';
	return new Date(iso).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

/** "Jul 28, 2026, 7:27 PM" in the viewer's locale; an em dash for nothing. */
export function formatDateTime(iso: string | null | undefined): string {
	if (!iso) return '—';
	return new Date(iso).toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
}
