// ABOUTME: Tauri quickstart (PRD §11) — identity in the app config dir via the fs plugin.
// ABOUTME: The Tauri store is async, so this adapter caches it in memory after first read.

import { BaseDirectory, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { CoolBeans } from '@coolbeans/sdk';

const FILE = 'license.json';
let cache: Record<string, string> = {};

/** Load once at startup, before constructing the client. */
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
		getItem: (k) => cache[k] ?? null,
		setItem: (k, v) => {
			cache[k] = v;
			// Fire and forget: the in-memory cache is authoritative for this run.
			void writeTextFile(FILE, JSON.stringify(cache), { baseDir: BaseDirectory.AppConfig });
		},
	},
});
