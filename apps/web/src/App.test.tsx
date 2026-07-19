// ABOUTME: Smoke tests for the console — primitives and a page render within providers.
// ABOUTME: Server rendering keeps these fast; live data is exercised in the API e2e suite.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dialog } from './components/Dialog.js';
import { StatusPill, TierText } from './components/ui.js';
import { AuthProvider, LoginScreen } from './lib/auth.js';

describe('primitives', () => {
	it('status pill is binary like the license contract', () => {
		expect(renderToString(<StatusPill status="active" />)).toContain('Active');
		expect(renderToString(<StatusPill status="disabled" />)).toContain('Disabled');
	});

	it('tier text colors lifetime, yearly, and trial distinctly', () => {
		expect(renderToString(<TierText tier="lifetime" />)).toContain('text-tier-lifetime');
		expect(renderToString(<TierText tier="trial" />)).toContain('text-warn');
		expect(renderToString(<TierText tier="yearly" />)).toContain('text-ink-secondary');
	});

	it('dialog mounts without rendering into the page itself', () => {
		// The card lives in a portal on document.body, which server rendering cannot
		// reach, so there is no markup to assert on here. What this still catches is the
		// dialog throwing on mount. Its actual behaviour — focus trap, focus return,
		// Escape, scroll lock — comes from Radix and is exercised against a real browser.
		const html = renderToString(
			<Dialog title="Issue a key" onClose={() => {}}>
				<span>body</span>
			</Dialog>,
		);
		expect(html).toBe('');
	});
});

describe('auth gate', () => {
	it('login screen starts the magic-code flow with an email prompt', () => {
		const qc = new QueryClient();
		const html = renderToString(
			<QueryClientProvider client={qc}>
				<AuthProvider>
					<LoginScreen />
				</AuthProvider>
			</QueryClientProvider>,
		);
		expect(html).toContain('Email me a code');
	});
});
