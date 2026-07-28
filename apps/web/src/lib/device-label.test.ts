// ABOUTME: Device labels for activation rows (issue #98) — a fingerprint UUID sent as the
// ABOUTME: instance name renders as a short device handle, a real name stays untouched.

import { describe, expect, it } from 'vitest';
import { deviceLabel } from './device-label.js';

describe('deviceLabel', () => {
	it('shortens a UUID fingerprint into a device handle', () => {
		expect(deviceLabel('41C7738D-4E0F-5A1F-9722-10369CCBC832')).toBe('Device 41C7738D');
		expect(deviceLabel('90db878cc6c144fabd74d2986e9da2a0')).toBe('Device 90DB878C');
	});

	it('keeps a human name exactly as the app sent it', () => {
		expect(deviceLabel("Chris's MacBook Pro")).toBe("Chris's MacBook Pro");
		expect(deviceLabel('build-agent-03')).toBe('build-agent-03');
	});

	it('names the empty string honestly', () => {
		expect(deviceLabel('')).toBe('Unnamed device');
	});
});
