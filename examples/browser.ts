// ABOUTME: Browser quickstart (PRD §11) — localStorage is used automatically, no storage needed.
// ABOUTME: Clearing site data resets the device identity, which costs one seat; deactivate first.

import { CoolBeans } from '@coolbeans/sdk';

const beans = new CoolBeans({
	product: 'clementine',
	baseUrl: 'https://keys.clementine.email',
});

export async function unlock(licenseKey: string): Promise<boolean> {
	if (await beans.verifyOffline()) return true;
	const result = await beans.verify(licenseKey);
	// Offline or unreachable is inconclusive: never lock a paying user out (§8).
	return result.inconclusive ? true : result.valid;
}

/** Call before the user clears site data or signs out of this browser. */
export async function releaseSeat(licenseKey: string, instanceId: string): Promise<void> {
	await beans.deactivate(licenseKey, { instanceId });
}
