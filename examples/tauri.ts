// ABOUTME: Tauri quickstart (PRD §11) — identity in the app config dir via the fs plugin.
// ABOUTME: The Tauri store is async, so this adapter caches it in memory after first read.

import { CoolBeans } from '@coolbeans/sdk';
import { BaseDirectory, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

const FILE = 'license.json';
let cache: Record<string, string> = {};

/** Load once at startup, BEFORE any licensing call, so the device id is the durable one. */
export async function loadLicenseStore(): Promise<void> {
	try {
		cache = JSON.parse(await readTextFile(FILE, { baseDir: BaseDirectory.AppConfig }));
	} catch {
		cache = {};
	}
}

export const beans = new CoolBeans({
	product: 'clementine',
	baseUrl: 'https://keys.clementine.email',
	storage: {
		getItem: (k: string) => cache[k] ?? null,
		setItem: (k: string, v: string) => {
			cache[k] = v;
			// Fire and forget: the in-memory cache is authoritative for this run.
			void writeTextFile(FILE, JSON.stringify(cache), { baseDir: BaseDirectory.AppConfig });
		},
	},
});

export async function unlock(licenseKey: string): Promise<boolean> {
	if (await beans.verifyOffline()) return true;

	const instanceId = beans.instanceId();
	if (!instanceId) return false;

	const result = await beans.verify(licenseKey, { instanceId });
	return result.inconclusive ? true : result.valid;
}
