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
		getItem: (k: string) => read()[k] ?? null,
		setItem: (k: string, v: string) => {
			writeFileSync(file, JSON.stringify({ ...read(), [k]: v }), { mode: 0o600 });
		},
	},
});

export async function activate(licenseKey: string): Promise<void> {
	await beans.activate(licenseKey, { name: 'Desktop app' });
}

export async function checkLicenseOnBoot(licenseKey: string): Promise<boolean> {
	if (await beans.verifyOffline()) return true;

	const instanceId = beans.instanceId();
	if (!instanceId) return false;

	const result = await beans.verify(licenseKey, { instanceId });
	return result.inconclusive ? true : result.valid;
}
