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
	baseUrl: 'https://keys.clementine.email',
	storage: {
		getItem: (k: string) => read()[k] ?? null,
		setItem: (k: string, v: string) => {
			writeFileSync(file, JSON.stringify({ ...read(), [k]: v }), { mode: 0o600 });
		},
	},
});

/**
 * Call on boot, and again when the renderer sends a pasted key. The SDK keeps itself fresh from
 * here on, so a revocation reaches a long-running app through `onChange` without polling.
 */
export async function checkLicenseOnBoot(licenseKey?: string): Promise<boolean> {
	const state = await beans.open(licenseKey, {
		onChange: (next) => {
			if (next.decision === 'deny') lockTheWindow(next.reason);
		},
	});
	return state.decision === 'allow';
}

/** On quit, so nothing is left running. */
export function shutdown(): void {
	beans.stop();
}

/** Whatever your app does to a window it must not let anyone keep using. */
declare function lockTheWindow(reason: string): void;
