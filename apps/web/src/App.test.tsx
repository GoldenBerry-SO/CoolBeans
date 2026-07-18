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

	it('dialog renders a titled card', () => {
		const html = renderToString(
			<Dialog title="Issue a key" onClose={() => {}}>
				<span>body</span>
			</Dialog>,
		);
		expect(html).toContain('Issue a key');
	});
});

describe('auth gate', () => {
	it('login screen prompts for the admin token', () => {
		const qc = new QueryClient();
		const html = renderToString(
			<QueryClientProvider client={qc}>
				<AuthProvider>
					<LoginScreen />
				</AuthProvider>
			</QueryClientProvider>,
		);
		expect(html).toContain('Admin token');
	});
});
