// ABOUTME: Browser quickstart (PRD §11) — localStorage is used automatically, no storage needed.
// ABOUTME: Clearing site data resets the device identity, which costs one seat; deactivate first.

import { CoolBeans } from '@coolbeans/sdk';

const beans = new CoolBeans({
	product: 'clementine',
	// Optional, and worth passing anyway: without it the first licence this install
	// activates decides which product the app is bound to, and that first key is the one
	// nobody checked. Only safe to omit if the vendor sells exactly one product.
	baseUrl: 'https://keys.clementine.email',
});

/**
 * Call on every start, and again when the user pastes a key. One call does both, and keeps the
 * app unlocked on every inconclusive answer.
 */
export async function unlock(licenseKey?: string): Promise<boolean> {
	const state = await beans.open(licenseKey, {
		// A revocation that arrives while the tab is open reaches the UI through here.
		onChange: (next) => {
			if (next.decision === 'deny') location.reload();
		},
	});
	return state.decision === 'allow';
}

/** Call before the user clears site data, so the seat goes back to them. */
export async function releaseSeat(): Promise<boolean> {
	return await beans.release();
}
