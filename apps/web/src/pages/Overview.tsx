// ABOUTME: Overview page — stat tiles, validations chart, recent activity, and audit preview.
// ABOUTME: Renders the docs/DESIGN.md structure with empty states until the admin API lands.

import { Card, CardHeader, EmptyState } from '../components/ui.js';

const STATS = [
	{ label: 'Active licenses', hint: 'across all products' },
	{ label: 'Validations · 24h', hint: 'edge reads' },
	{ label: 'Live activations', hint: 'seats in use' },
	{ label: 'Revenue events · 30d', hint: 'checkouts, renewals' },
];

export function OverviewPage() {
	return (
		<div className="cbin max-w-[1180px]">
			<div className="mb-4 grid grid-cols-4 gap-4">
				{STATS.map((s) => (
					<Card key={s.label} className="px-[18px] py-[17px]">
						<div className="font-medium text-[12px] text-ink-muted">{s.label}</div>
						<div className="my-[6px] font-semibold text-[27px] tracking-[-0.02em]">—</div>
						<div className="text-[12px] text-ink-faint">{s.hint}</div>
					</Card>
				))}
			</div>
			<div className="mb-4 grid grid-cols-[1.5fr_1fr] gap-4">
				<Card>
					<CardHeader title="Validations" />
					<EmptyState>No validations yet — they'll chart here as keys phone home.</EmptyState>
				</Card>
				<Card>
					<CardHeader title="Recent activity" />
					<EmptyState>Quiet so far. Issued keys and activations show up here.</EmptyState>
				</Card>
			</div>
			<Card>
				<CardHeader title="Audit log" />
				<EmptyState>Every state change lands here, with its actor.</EmptyState>
			</Card>
		</div>
	);
}
