// ABOUTME: Webhooks page — provider endpoint health cards and the incoming event stream.
// ABOUTME: Configured means we hold the credentials to verify and act on a delivery.

import { clsx } from 'clsx';
import { Card, EmptyState, TableHead } from '../components/ui.js';
import { formatDateTime } from '../lib/dates.js';
import { useBilling, useProviderEvents, useProviders } from '../lib/queries.js';

const GRID = 'min-w-[760px] grid-cols-[0.75fr_1.9fr_1.1fr_0.85fr_0.65fr]';

function ProviderPill({ provider }: { provider: string }) {
	// Platform-billing deliveries (the vendor's own Cool Beans subscription) are a different
	// story from product issuance, so they read differently rather than as another "stripe".
	if (provider.toLowerCase() === 'stripe_billing') {
		return (
			<span className="inline-flex w-fit rounded-[6px] bg-fill px-[9px] py-[2px] font-semibold text-[11px] text-ink-muted">
				Your plan
			</span>
		);
	}
	const stripe = provider.toLowerCase() === 'stripe';
	return (
		<span
			className={clsx(
				'inline-flex w-fit rounded-[6px] px-[9px] py-[2px] font-semibold text-[11px] capitalize',
				stripe ? 'bg-[#efeefb] text-stripe' : 'bg-[#eaf1fb] text-[#1c64c4]',
			)}
		>
			{provider}
		</span>
	);
}

function statusLabel(status: string): { label: string; className: string } {
	if (status === 'done') return { label: 'Delivered', className: 'text-positive-deep' };
	if (status === 'failed') return { label: 'Failed', className: 'text-danger' };
	return { label: 'In flight', className: 'text-warn' };
}

export function WebhooksPage() {
	const billing = useBilling();
	const providers = useProviders();
	const events = useProviderEvents();
	// Billing configured is what makes an instance cloud. A Connect vendor's payment events
	// arrive on the platform endpoint automatically, so showing them "stripe · not
	// configured" hands them setup homework that cannot be done (#109). Self-host keeps the
	// cards: there they are real wiring state.
	const isCloud = Boolean(billing.data?.enabled);

	return (
		<div className="cbin">
			{isCloud ? (
				<Card className="mb-4 px-[18px] py-4">
					<div className="font-semibold text-[13px]">Nothing to configure</div>
					<p className="m-0 mt-1 text-[12.5px] text-ink-muted leading-[1.55]">
						Payment events from your connected Stripe arrive here automatically. Every delivery
						below was signature-verified before anything acted on it.
					</p>
				</Card>
			) : (
				<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:gap-4">
					{(providers.data ?? []).map((p) => (
						<Card key={p.name} className="flex-1 px-[18px] py-4">
							<div className="flex items-center gap-[9px]">
								<span
									className={clsx(
										'h-[9px] w-[9px] rounded-full',
										p.configured ? 'bg-positive' : 'bg-ink/20',
									)}
								/>
								<span className="font-semibold text-[13px] capitalize">{p.name}</span>
							</div>
							<div className="mt-1.5 break-all font-mono text-[12px] text-ink-faint">
								{p.path} · {p.configured ? 'verified' : 'not configured'}
							</div>
						</Card>
					))}
				</div>
			)}
			<Card className="overflow-x-auto">
				<div className="border-ink/8 border-b px-[18px] py-[15px]">
					<div className="font-semibold text-[13px]">Incoming payment events</div>
					<div className="mt-0.5 text-[11.5px] text-ink-faint">
						Deliveries we received, with their verification and processing status.
					</div>
				</div>
				<TableHead gridClass={GRID} columns={['Provider', 'Event', 'Event id', 'When', 'Status']} />
				{events.isLoading ? (
					<EmptyState>Loading…</EmptyState>
				) : events.data?.length ? (
					events.data.map((e) => {
						const s = statusLabel(e.status);
						return (
							<div
								key={e.id}
								className={clsx(
									'grid items-center gap-3.5 border-ink/5 border-b px-[18px] py-3 text-[12.5px] last:border-b-0',
									GRID,
								)}
							>
								<ProviderPill provider={e.provider} />
								<span className="truncate font-mono text-[12px]">{e.type}</span>
								<span className="truncate font-mono text-[10px] text-ink-faint">{e.id}</span>
								<span className="font-mono text-[11.5px] text-ink-faint">
									{formatDateTime(e.received_at)}
								</span>
								<span className={clsx('font-semibold text-[11.5px]', s.className)}>{s.label}</span>
							</div>
						);
					})
				) : (
					<EmptyState>Signature-verified events stream in here.</EmptyState>
				)}
			</Card>
		</div>
	);
}
