// ABOUTME: Humanizes audit entries for the console — verbs for activity, terse detail strings.
// ABOUTME: Renders only fields the API actually recorded; unknown shapes fall back to key=value.

import type { AuditEntry } from './types.js';

/** "license.issued" → "Issued", "instance.activated" → "Activated" … for the activity feed. */
export function actionVerb(action: string): string {
	const tail = action.split('.').pop() ?? action;
	return tail.charAt(0).toUpperCase() + tail.slice(1).replace(/_/g, ' ');
}

/** Flatten the recorded detail into one terse human line, design-style. */
export function formatDetail(entry: AuditEntry): string {
	const d = entry.detail;
	if (!d) return '—';
	const parts: string[] = [];
	if (typeof d.key_suffix === 'string') parts.push(`…-${d.key_suffix}`);
	if (typeof d.name === 'string') parts.push(String(d.name));
	if (typeof d.slug === 'string')
		parts.push(typeof d.prefix === 'string' ? `${d.slug} (${d.prefix})` : String(d.slug));
	if (typeof d.tier === 'string') parts.push(String(d.tier));
	if (typeof d.reason === 'string') parts.push(`reason=${d.reason}`);
	if (typeof d.email === 'string') parts.push(`→ ${d.email}`);
	if (parts.length) return parts.join(' · ');
	return Object.entries(d)
		.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
		.join(' · ');
}

/** The mono fragment worth highlighting (key suffix or instance name), if any. */
export function detailHighlight(entry: AuditEntry): string | null {
	const d = entry.detail;
	if (!d) return null;
	if (typeof d.key_suffix === 'string') return `…-${d.key_suffix}`;
	if (typeof d.name === 'string') return String(d.name);
	if (typeof d.slug === 'string') return String(d.slug);
	return null;
}
