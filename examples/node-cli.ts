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

export async function activate(licenseKey: string): Promise<void> {
	await beans.activate(licenseKey, { name: `${process.platform} CLI` });
}

export async function unlock(licenseKey: string): Promise<boolean> {
	if (await beans.verifyOffline()) return true;

	const instanceId = beans.instanceId();
	if (!instanceId) return false;

	const result = await beans.verify(licenseKey, { instanceId });
	// Network trouble is inconclusive, never a lockout (§8).
	return result.inconclusive ? true : result.valid;
}
