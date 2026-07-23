// ABOUTME: The seat-model labels read as plain language while the wire values stay frozen.
// ABOUTME: The dialog itself (radix portal) is verified in a browser; this pins the mapping.

import { describe, expect, it } from 'vitest';
import { SEAT_MODELS, seatModelHint, seatModelLabel } from './seat-model.js';

describe('seat model presentation', () => {
	it('maps the frozen wire values to plain labels', () => {
		expect(seatModelLabel('node_locked')).toBe('Per device');
		expect(seatModelLabel('floating')).toBe('Concurrent');
	});

	it('keeps the wire values that the §9 contract and API depend on', () => {
		expect(SEAT_MODELS.map((m) => m.value)).toEqual(['node_locked', 'floating']);
	});

	it('never shows the old jargon', () => {
		for (const m of SEAT_MODELS) {
			expect(m.label).not.toMatch(/node.?locked|floating/i);
		}
	});

	it('gives each model a hint, and falls back to the default for an unknown value', () => {
		expect(seatModelHint('floating')).toContain('shared pool');
		expect(seatModelHint('node_locked')).toContain('one machine');
		// An unrecognised value degrades to the default rather than blanking the hint.
		expect(seatModelHint('something_new')).toBe(seatModelHint('node_locked'));
		expect(seatModelLabel('something_new')).toBe('Per device');
	});
});
