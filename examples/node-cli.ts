// ABOUTME: Node/CLI quickstart (PRD §11) — durable device identity in the user's config dir.
// ABOUTME: Without durable storage every restart mints a new device and burns another seat.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CoolBeans } from '@coolbeans/sdk';

/** A tiny synchronous file store: the SDK only needs getItem/setItem. */
function fileStorage(path: string) {
	mkdirSync(dirname(path), { recursive: true });
	const read = (): Record<string, string> => {
		try {
			return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
		} catch {
			return {};
		}
	};
	return {
		getItem: (k: string) => read()[k] ?? null,
		setItem: (k: string, v: string) => {
			const all = read();
			all[k] = v;
			writeFileSync(path, JSON.stringify(all), { mode: 0o600 });
		},
	};
}

const beans = new CoolBeans({
	baseUrl: 'https://keys.clementine.email',
	storage: fileStorage(join(homedir(), '.config', 'clementine', 'license.json')),
});

/**
 * Run on every invocation. One call: it activates the first time, refreshes when it can, and
 * falls back to the cached signed token when it cannot. The key is optional after the first
 * run — it is stored with the token.
 *
 * The background refresh timers are unref'd, so a CLI that prints and exits still exits.
 */
export async function unlock(licenseKey?: string): Promise<boolean> {
	const state = await beans.open(licenseKey);
	if (state.decision === 'deny') {
		// Only three reasons ever reach here, and they are different sentences to a user.
		if (state.reason === 'uninitialized') console.error('Enter your licence key to continue.');
		if (state.reason === 'expired') console.error('That licence has ended.');
		if (state.reason === 'revoked') console.error('That licence was revoked.');
		return false;
	}
	// Read off the licence, never assumed from the product.
	if (state.entitlements?.batch_limit) {
		console.error(`Batch limit: ${state.entitlements.batch_limit}`);
	}
	return true;
}

/** Give the seat back, so another machine can take it. */
export async function signOut(): Promise<boolean> {
	return await beans.release();
}
