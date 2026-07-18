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
	product: 'clementine',
	baseUrl: 'https://keys.clementine.email',
	storage: fileStorage(join(homedir(), '.config', 'clementine', 'license.json')),
});

export async function unlock(licenseKey: string): Promise<boolean> {
	// Offline first: no network round trip on a normal start.
	if (await beans.verifyOffline()) return true;

	const result = await beans.verify(licenseKey);
	// Network trouble is inconclusive, never a lockout (§8).
	if (result.inconclusive) return true;
	return result.valid;
}

export async function activateOnce(licenseKey: string) {
	return beans.activate(licenseKey, { instanceName: `${process.platform} CLI` });
}
