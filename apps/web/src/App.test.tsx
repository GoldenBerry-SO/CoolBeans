// ABOUTME: Smoke tests for the console — primitives and a page render within providers.
// ABOUTME: Server rendering keeps these fast; live data is exercised in the API e2e suite.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dialog } from './components/Dialog.js';
import { KindText, LimitBadge, StatusPill } from './components/ui.js';
import { AuthProvider, LoginScreen } from './lib/auth.js';

describe('primitives', () => {
	it('status pill is binary like the license contract', () => {
		expect(renderToString(<StatusPill status="active" />)).toContain('Active');
		expect(renderToString(<StatusPill status="disabled" />)).toContain('Disabled');
	});

	it('kind text colors perpetual, subscription, and trial distinctly', () => {
		expect(renderToString(<KindText kind="perpetual" />)).toContain('text-tier-lifetime');
		expect(renderToString(<KindText kind="trial" />)).toContain('text-warn');
		expect(renderToString(<KindText kind="subscription" />)).toContain('text-ink-secondary');
	});

	it('says at limit when full and over limit only when genuinely exceeded', () => {
		// Somebody on Free using their one allowed product is exactly within their plan.
		// Calling that "over limit" reads as a violation they have not committed.
		expect(renderToString(<LimitBadge current={1} limit={1} />)).toContain('At limit');
		expect(renderToString(<LimitBadge current={2} limit={1} />)).toContain('Over limit');
		expect(renderToString(<LimitBadge current={0} limit={1} />)).toContain('OK');
		// Null is no cap, so there is nothing to badge.
		expect(renderToString(<LimitBadge current={900} limit={null} />)).toBe('');
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
