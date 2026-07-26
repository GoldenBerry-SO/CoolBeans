// ABOUTME: Tauri quickstart (PRD §11) — identity in the app config dir via the fs plugin.
// ABOUTME: The Tauri store is async, so this adapter caches it in memory after first read.

import { CoolBeans } from '@coolbeans/sdk';
import { BaseDirectory, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

const FILE = 'license.json';
let cache: Record<string, string> = {};
let writeQueue: Promise<void> = Promise.resolve();

/** Load once at startup, BEFORE any licensing call, so the device id is the durable one. */
export async function loadLicenseStore(): Promise<void> {
	try {
		cache = JSON.parse(await readTextFile(FILE, { baseDir: BaseDirectory.AppConfig }));
	} catch {
		cache = {};
	}
}

export const beans = new CoolBeans({
	baseUrl: 'https://keys.clementine.email',
	storage: {
		getItem: (k: string) => cache[k] ?? null,
		setItem: (k: string, v: string) => {
			cache[k] = v;
			// Writes are chained rather than fired in parallel: two overlapping writes can
			// otherwise land out of order and persist a stale snapshot of the cache.
			writeQueue = writeQueue
				.then(() =>
					writeTextFile(FILE, JSON.stringify(cache), { baseDir: BaseDirectory.AppConfig }),
				)
				.catch(() => {
					// A failed persist leaves the in-memory cache authoritative for this run.
				});
		},
	},
});

/** Call after loadLicenseStore(), on every start and whenever a key is pasted. */
export async function unlock(licenseKey?: string): Promise<boolean> {
	const state = await beans.open(licenseKey);
	return state.decision === 'allow';
}
