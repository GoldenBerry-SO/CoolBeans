// ABOUTME: Billing page states — Free vs Pro, the dunning strip, and the self-host case.
// ABOUTME: Server rendering keeps these fast; the seeded query cache stands in for the API.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Billing } from '../lib/types.js';
import { BillingPage } from './Billing.js';

function billing(overrides: Partial<Billing> = {}): Billing {
	return {
		enabled: true,
		plan: 'free',
		status: null,
		current_period_end: null,
		cancel_at_period_end: false,
		past_due_since: null,
		over_limit_since: null,
		usage: {
			products: { current: 1, limit: 1 },
			active_licenses: { current: 12, limit: 500 },
		},
		...overrides,
	};
}

/** Render with the ['billing'] query pre-seeded, so no fetch happens. */
function render(data: Billing): string {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	qc.setQueryData(['billing'], data);
	return renderToString(
		<QueryClientProvider client={qc}>
			<BillingPage />
		</QueryClientProvider>,
	);
}

describe('billing page', () => {
	it('offers the upgrade on Free and states the caps', () => {
		const html = render(billing());
		expect(html).toContain('Upgrade to Pro');
		expect(html).toContain('500 active licences');
		expect(html).not.toContain('Manage billing');
	});

	it('offers the portal on Pro and shows the renewal date', () => {
		const html = render(
			billing({ plan: 'pro', status: 'active', current_period_end: '2027-03-04T00:00:00.000Z' }),
		);
		expect(html).toContain('Manage billing');
		expect(html).not.toContain('Upgrade to Pro');
		expect(html).toContain('Renews on');
	});

	it('says when a cancelled subscription actually ends', () => {
		// They keep Pro until the period is up, and the page should say so rather than
		// leaving them wondering whether access already went.
		const html = render(
			billing({
				plan: 'pro',
				cancel_at_period_end: true,
				current_period_end: '2027-03-04T00:00:00.000Z',
			}),
		);
		expect(html).toContain('Cancels on');
		expect(html).toContain('You keep Pro until then');
	});

	it('shows a dunning strip that says nothing was switched off', () => {
		const html = render(
			billing({ plan: 'pro', status: 'past_due', past_due_since: '2027-02-01T00:00:00.000Z' }),
		);
		expect(html).toContain('Payment failed');
		expect(html).toContain('Nothing has been switched off yet');
	});

	it('tells an over-limit account their keys were still issued', () => {
		const html = render(billing({ over_limit_since: '2027-02-01T00:00:00.000Z' }));
		expect(html).toContain('over your plan');
		expect(html).toContain('were still issued');
	});

	it('shows unlimited usage and no upgrade path on self-host', () => {
		const html = render(
			billing({
				enabled: false,
				usage: {
					products: { current: 3, limit: null },
					active_licenses: { current: 900, limit: null },
				},
			}),
		);
		expect(html).toContain('self-hosted');
		expect(html).toContain('free forever');
		// Never sell a self-hoster something PRD §7 already gives them.
		expect(html).not.toContain('Upgrade to Pro');
	});
});
