// ABOUTME: Provider-event claim tests (PRD §13) — a redelivered event is processed exactly once.
// ABOUTME: A failed handler releases its claim so the provider's retry can re-enter.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { claimEvent, claimOutcomeForRow, completeEvent, releaseEvent } from './payments.js';

let h: TestHarness;
const EVENT = { id: 'evt_1', provider: 'stripe', type: 'checkout.session.completed' };

beforeEach(() => {
	h = makeHarness();
});

describe('provider event claims', () => {
	it('only the first claimant may process an event', () => {
		expect(claimEvent(h.deps, EVENT)).toBe(true);
		// A concurrent redelivery arrives before the first finished.
		expect(claimEvent(h.deps, EVENT)).toBe(false);
	});

	it('a completed event is never processed again', () => {
		claimEvent(h.deps, EVENT);
		completeEvent(h.deps, EVENT.id);
		expect(claimEvent(h.deps, EVENT)).toBe(false);
	});

	it('a released claim lets the provider retry re-enter', () => {
		claimEvent(h.deps, EVENT);
		releaseEvent(h.deps, EVENT.id); // handler threw; email never sent
		expect(claimEvent(h.deps, EVENT)).toBe(true);
	});

	it('reclaims an abandoned in-flight event so a crash cannot wedge it forever', () => {
		claimEvent(h.deps, EVENT);
		h.clock.advance(10 * 60_000);
		expect(claimEvent(h.deps, EVENT)).toBe(true);
	});
});

describe('reading the event row after a refused claim', () => {
	// The interleaving that produces a missing row (another worker releasing between our
	// two statements) cannot be staged against a synchronous driver, so the decision is
	// tested directly — it is the part that would silently drop a delivery.
	it('treats a vanished row as retryable, never as finished', () => {
		expect(claimOutcomeForRow(undefined)).toBe('in_flight');
	});

	it('still recognises a genuinely completed event', () => {
		expect(claimOutcomeForRow({ status: 'done' })).toBe('done');
	});

	it('recognises another worker mid-flight', () => {
		expect(claimOutcomeForRow({ status: 'processing' })).toBe('in_flight');
	});
});
