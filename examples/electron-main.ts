// ABOUTME: Electron main-process quickstart (PRD §11) — identity in userData, survives updates.
// ABOUTME: Do the licensing in main, not the renderer, so the key never sits in web content.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoolBeans } from '@coolbeans/sdk';
import { app } from 'electron';

const file = join(app.getPath('userData'), 'license.json');
const read = (): Record<string, string> => {
	try {
		return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
	} catch {
		return {};
	}
};

const beans = new CoolBeans({
	product: 'clementine',
	baseUrl: 'https://keys.clementine.email',
	storage: {
		getItem: (k) => read()[k] ?? null,
		setItem: (k, v) => {
			writeFileSync(file, JSON.stringify({ ...read(), [k]: v }), { mode: 0o600 });
		},
	},
});

export async function checkLicenseOnBoot(licenseKey: string): Promise<boolean> {
	if (await beans.verifyOffline()) return true;
	const result = await beans.verify(licenseKey);
	return result.inconclusive ? true : result.valid;
}
