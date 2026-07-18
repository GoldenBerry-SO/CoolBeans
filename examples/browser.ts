// ABOUTME: Browser quickstart (PRD §11) — localStorage is used automatically, no storage needed.
// ABOUTME: Clearing site data resets the device identity, which costs one seat; deactivate first.

import { CoolBeans } from '@coolbeans/sdk';

const beans = new CoolBeans({
	product: 'clementine',
	baseUrl: 'https://keys.clementine.email',
});

/** Call once, when the user first pastes their key. */
export async function activate(licenseKey: string): Promise<void> {
	await beans.activate(licenseKey);
}

/** Call on every start. Offline-first: no network round trip on the happy path. */
export async function unlock(licenseKey: string): Promise<boolean> {
	if (await beans.verifyOffline()) return true;

	const instanceId = beans.instanceId();
	// Never activated on this device yet, so there is nothing to verify against.
	if (!instanceId) return false;

	const result = await beans.verify(licenseKey, { instanceId });
	// Offline or unreachable is inconclusive: never lock a paying user out (§8).
	return result.inconclusive ? true : result.valid;
}

/** Call before the user clears site data, so the seat goes back to them. */
export async function releaseSeat(licenseKey: string): Promise<void> {
	const instanceId = beans.instanceId();
	if (instanceId) await beans.deactivate(licenseKey, { instanceId });
}
