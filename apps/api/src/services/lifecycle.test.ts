// ABOUTME: The restore policy — which disables a payment event may undo, and which it may not.
// ABOUTME: Pure, so both failure directions are tested without staging a whole webhook sequence.

import { describe, expect, it } from 'vitest';
import { type RestoreTrigger, restoreAllowed } from './lifecycle.js';

describe('restoreAllowed', () => {
	it('lets a recovered subscription undo the lapse it caused', async () => {
		expect(restoreAllowed('subscription_canceled', 'subscription_recovered')).toBe(true);
	});

	it('lets a won dispute undo the chargeback it caused', async () => {
		expect(restoreAllowed('chargeback', 'dispute_won')).toBe(true);
	});

	// The expensive direction: handing access back to someone who took their money back.
	it('never lets a payment event undo a refund', async () => {
		expect(restoreAllowed('refund', 'subscription_recovered')).toBe(false);
		expect(restoreAllowed('refund', 'dispute_won')).toBe(false);
	});

	it('never lets a payment event undo an admin decision', async () => {
		expect(restoreAllowed('manual', 'subscription_recovered')).toBe(false);
		expect(restoreAllowed('manual', 'dispute_won')).toBe(false);
	});

	it('never lets a payment event revive an expired trial', async () => {
		expect(restoreAllowed('trial_expired', 'subscription_recovered')).toBe(false);
		expect(restoreAllowed('trial_expired', 'dispute_won')).toBe(false);
	});

	it('does not cross the two triggers', async () => {
		// A won dispute says nothing about whether the subscription is being paid, and a
		// recovered subscription says nothing about who won the chargeback.
		expect(restoreAllowed('subscription_canceled', 'dispute_won')).toBe(false);
		expect(restoreAllowed('chargeback', 'subscription_recovered')).toBe(false);
	});

	it('treats an unknown or missing reason as not restorable', async () => {
		const triggers: RestoreTrigger[] = ['subscription_recovered', 'dispute_won'];
		for (const trigger of triggers) {
			expect(restoreAllowed(null, trigger)).toBe(false);
			expect(restoreAllowed('something_we_added_later', trigger)).toBe(false);
		}
	});
});
