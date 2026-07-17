// ABOUTME: Webhooks page — provider endpoint health cards and the incoming event stream.
// ABOUTME: Providers show unconfigured until Stripe/PayPal wiring is completed.

import { Card, EmptyState, TableHead } from '../components/ui.js';

const PROVIDERS = [
	{ name: 'Stripe', path: '/v1/stripe/webhook' },
	{ name: 'PayPal', path: '/v1/paypal/webhook' },
];

export function WebhooksPage() {
	return (
		<div className="cbin max-w-[1180px]">
			<div className="mb-4 flex gap-4">
				{PROVIDERS.map((p) => (
					<Card key={p.name} className="flex-1 px-[18px] py-4">
						<div className="flex items-center gap-[9px]">
							<span className="h-[9px] w-[9px] rounded-full bg-ink/20" />
							<span className="font-semibold text-[13px]">{p.name}</span>
						</div>
						<div className="mt-1.5 font-mono text-[12px] text-ink-faint">
							{p.path} · not configured
						</div>
					</Card>
				))}
			</div>
			<Card className="overflow-hidden">
				<TableHead
					gridClass="grid-cols-[0.75fr_1.7fr_1.3fr_0.85fr_0.65fr]"
					columns={['Provider', 'Event', 'Detail', 'When', 'Status']}
				/>
				<EmptyState>Signature-verified events stream in here.</EmptyState>
			</Card>
		</div>
	);
}
