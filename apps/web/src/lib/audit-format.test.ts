// ABOUTME: Activity feed verbs (issue #99) — activation events read as what happened to a seat,
// ABOUTME: not as a bare "Created" that could mean anything in the feed.

import { describe, expect, it } from 'vitest';
import { actionVerb } from './audit-format.js';

describe('actionVerb', () => {
	it('names activation lifecycle in seat language', () => {
		expect(actionVerb('activation.created')).toBe('Activated');
		expect(actionVerb('activation.deactivated')).toBe('Seat freed');
		expect(actionVerb('activation.offline_issued')).toBe('Offline activation');
	});

	it('still humanizes anything it has no special name for', () => {
		expect(actionVerb('license.issued')).toBe('Issued');
		expect(actionVerb('payment.quantity_mismatch')).toBe('Quantity mismatch');
	});
});
