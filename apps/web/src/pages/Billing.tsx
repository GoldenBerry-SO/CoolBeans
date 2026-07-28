// ABOUTME: Billing page — the account's plan, what it has used, and the way to change it.
// ABOUTME: Only reachable on a hosted instance; self-host has no limits and nothing to sell.

import { clsx } from 'clsx';
import {
	AccentButton,
	Card,
	CardHeader,
	EmptyState,
	LimitBadge,
	Meter,
	SecondaryButton,
} from '../components/ui.js';
import { formatDate } from '../lib/dates.js';
import { useBilling, useOpenPortal, useStartCheckout } from '../lib/queries.js';
import type { PlanUsage } from '../lib/types.js';

function UsageRow({ label, usage }: { label: string; usage: PlanUsage }) {
	const over = usage.limit !== null && usage.current >= usage.limit;
	return (
		<div className="grid items-center gap-x-4 gap-y-3 border-ink/5 border-b px-4 py-[15px] last:border-b-0 sm:grid-cols-[1.4fr_0.8fr_2fr_0.8fr] sm:gap-[18px] sm:px-5">
			<div className="font-medium text-[13px]">{label}</div>
			<div className={clsx('font-mono text-[12.5px]', over ? 'text-danger' : 'text-ink-secondary')}>
				{usage.current.toLocaleString()}
				{usage.limit === null ? '' : ` / ${usage.limit.toLocaleString()}`}
			</div>
			<Meter current={usage.current} limit={usage.limit} />
			<div className="text-right">
				<LimitBadge current={usage.current} limit={usage.limit} />
			</div>
		</div>
	);
}

/** A strip that has to be impossible to miss: their card failed and Pro is about to lapse. */
function PastDueStrip({ since }: { since: string }) {
	return (
		<div className="mb-4 rounded-[10px] border border-danger/25 bg-danger-tint px-4 py-3 text-[13px] text-danger">
			<strong className="font-semibold">Payment failed.</strong> We have been retrying since{' '}
			{formatDate(since)}. Update your card to keep Pro. Nothing has been switched off yet.
		</div>
	);
}

/** Over the plan but still serving: keys issued past the cap were delivered, not refused. */
function OverLimitStrip({ since }: { since: string }) {
	return (
		<div className="mb-4 rounded-[10px] border border-warn/25 bg-warn-tint px-4 py-3 text-[13px] text-warn">
			<strong className="font-semibold">You are over your plan.</strong> Keys bought since{' '}
			{formatDate(since)} were still issued, so nobody was left without one. Upgrade to Pro to clear
			this.
		</div>
	);
}

export function BillingPage() {
	// The success return can beat Stripe's webhook, so poll for a short while rather than
	// telling somebody who just paid that they are on Free.
	const returningFromCheckout =
		typeof window !== 'undefined' && window.location.search.includes('upgraded=1');
	const billing = useBilling(returningFromCheckout);
	const checkout = useStartCheckout();
	const portal = useOpenPortal();

	if (billing.isLoading) {
		return (
			<div className="cbin">
				<Card>
					<EmptyState>Loading…</EmptyState>
				</Card>
			</div>
		);
	}

	const data = billing.data;
	if (!data?.enabled) {
		// Should be unreachable: the nav entry and route are both hidden when billing is
		// off. Kept as a plain statement of fact rather than an upgrade prompt.
		return (
			<div className="cbin">
				<Card>
					<EmptyState>
						This is a self-hosted Cool Beans. Unlimited products, keys and activations, free
						forever.
					</EmptyState>
				</Card>
			</div>
		);
	}

	const isPro = data.plan === 'pro';
	return (
		<div className="cbin">
			{data.past_due_since ? <PastDueStrip since={data.past_due_since} /> : null}
			{data.over_limit_since && !isPro ? <OverLimitStrip since={data.over_limit_since} /> : null}
			{returningFromCheckout && !isPro ? (
				<div className="mb-4 rounded-[10px] border border-ink/12 bg-fill-soft px-4 py-3 text-[13px] text-ink-secondary">
					Thanks — confirming your payment with Stripe. This page will update in a moment.
				</div>
			) : null}

			<Card className="mb-4">
				<CardHeader
					title={
						<>
							Plan{' '}
							<span
								className={clsx(
									'ml-1 inline-flex rounded-full px-[9px] py-[3px] font-semibold text-[11px]',
									isPro ? 'bg-positive-tint text-positive-deep' : 'bg-ink/6 text-ink-secondary',
								)}
							>
								{isPro ? 'Pro' : 'Free'}
							</span>
						</>
					}
					action={
						isPro ? (
							<SecondaryButton onClick={() => portal.mutate()} disabled={portal.isPending}>
								{portal.isPending ? 'Opening…' : 'Manage billing'}
							</SecondaryButton>
						) : (
							<AccentButton onClick={() => checkout.mutate()} disabled={checkout.isPending}>
								{checkout.isPending ? 'Opening…' : 'Upgrade to Pro'}
							</AccentButton>
						)
					}
				/>
				<div className="px-4 py-4 text-[13px] text-ink-secondary sm:px-5">
					{isPro ? (
						<>
							<div>
								$99 a year, unlimited products and licences. No per-seat or per-licence fees.
							</div>
							<div className="mt-1.5 text-ink-faint">
								{data.cancel_at_period_end
									? `Cancels on ${formatDate(data.current_period_end)}. You keep Pro until then.`
									: `Renews on ${formatDate(data.current_period_end)}.`}
							</div>
						</>
					) : (
						<>
							<div>One product and 500 active licences. Unlimited validations, always.</div>
							<div className="mt-1.5 text-ink-faint">
								Pro is $99 a year for unlimited everything. We never charge per licence.
							</div>
						</>
					)}
				</div>
			</Card>

			<Card className="overflow-hidden">
				<CardHeader title="Usage against your plan" />
				<UsageRow label="Products" usage={data.usage.products} />
				<UsageRow label="Active licences" usage={data.usage.active_licenses} />
			</Card>
		</div>
	);
}
