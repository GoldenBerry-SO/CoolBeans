// ABOUTME: The shared date formatters (issue #94) — every console surface renders through these,
// ABOUTME: so no page shows a raw ISO timestamp like 2026-07-28T19:27:09.667Z again.

import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './dates.js';

describe('formatDate', () => {
	it('renders a calendar date, not an ISO string', () => {
		const out = formatDate('2026-07-28T19:27:09.667Z');
		expect(out).not.toContain('T');
		expect(out).not.toContain(':');
		expect(out).toMatch(/2026/);
	});

	it('renders an em dash for nothing', () => {
		expect(formatDate(null)).toBe('—');
		expect(formatDate(undefined)).toBe('—');
	});
});

describe('formatDateTime', () => {
	it('keeps the time of day but drops the ISO noise', () => {
		const out = formatDateTime('2026-07-28T19:27:09.667Z');
		expect(out).not.toContain('T');
		expect(out).not.toContain('.667');
		expect(out).not.toContain('Z');
		expect(out).toMatch(/2026/);
		expect(out).toMatch(/\d{1,2}:\d{2}/);
	});

	it('renders an em dash for nothing', () => {
		expect(formatDateTime(null)).toBe('—');
	});
});
