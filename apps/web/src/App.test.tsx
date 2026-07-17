// ABOUTME: Smoke tests for the console — pages and primitives render per the design system.
// ABOUTME: Server rendering keeps these fast with no DOM environment.

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusPill, TierText } from './components/ui.js';
import { LicensesPage } from './pages/Licenses.js';
import { OverviewPage } from './pages/Overview.js';
import { WebhooksPage } from './pages/Webhooks.js';

describe('console pages', () => {
	it('overview renders the stat tiles', () => {
		const html = renderToString(<OverviewPage />);
		expect(html).toContain('Active licenses');
		expect(html).toContain('Validations');
	});

	it('licenses renders filters, table head, and empty state', () => {
		const html = renderToString(<LicensesPage />);
		expect(html).toContain('License key');
		expect(html).toContain('Disabled');
		expect(html).toContain('No keys yet');
	});

	it('webhooks lists both provider endpoints', () => {
		const html = renderToString(<WebhooksPage />);
		expect(html).toContain('/v1/stripe/webhook');
		expect(html).toContain('/v1/paypal/webhook');
	});
});

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
});
