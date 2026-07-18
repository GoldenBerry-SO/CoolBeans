// ABOUTME: The stale-event rule (issue #54) — arrival order is not event order.
// ABOUTME: Pure, because too strict drops a real cancellation and too loose revives a dead key.

import { describe, expect, it } from 'vitest';
import { shouldApplySubscriptionEvent } from './event-order.js';

describe('shouldApplySubscriptionEvent', () => {
	it('applies the first event we have ever seen for a subscription', () => {
		expect(shouldApplySubscriptionEvent(1_000, null)).toBe(true);
		expect(shouldApplySubscriptionEvent(1_000, undefined)).toBe(true);
	});

	it('applies a newer event', () => {
		expect(shouldApplySubscriptionEvent(2_000, 1_000)).toBe(true);
	});

	it('ignores an older event, which is the whole point', () => {
		// A delayed 'active' arriving after the cancellation that superseded it.
		expect(shouldApplySubscriptionEvent(1_000, 2_000)).toBe(false);
	});

	it('applies an event with the same timestamp', () => {
		// Stripe stamps whole seconds, so two events in one second are ambiguous.
		// Dropping the second would lose real transitions; applying it only risks
		// re-applying something already applied, which every handler tolerates.
		expect(shouldApplySubscriptionEvent(1_000, 1_000)).toBe(true);
	});

	it('applies an event with no timestamp rather than dropping it', () => {
		// Silently refusing an untimestamped event would be a lockout with no trace.
		expect(shouldApplySubscriptionEvent(undefined, 5_000)).toBe(true);
		expect(shouldApplySubscriptionEvent(undefined, null)).toBe(true);
	});

	it('treats epoch zero as a real timestamp, not a missing one', () => {
		expect(shouldApplySubscriptionEvent(0, 1_000)).toBe(false);
		expect(shouldApplySubscriptionEvent(1_000, 0)).toBe(true);
	});
});
