// ABOUTME: Overview page (PRD §16) — live stat tiles and a recent audit preview.
// ABOUTME: Stats from GET /admin/stats; activity from GET /admin/audit.

import { Link } from '@tanstack/react-router';
import { Card, CardHeader, EmptyState } from '../components/ui.js';
import { useAudit, useStats } from '../lib/queries.js';

export function OverviewPage() {
	const stats = useStats();
	const audit = useAudit();
	const tiles = [
		{ label: 'Products', value: stats.data?.products, hint: 'onboarded' },
		{ label: 'Active licenses', value: stats.data?.active_licenses, hint: 'across all products' },
		{ label: 'Total licenses', value: stats.data?.total_licenses, hint: 'issued all-time' },
		{ label: 'Live activations', value: stats.data?.live_activations, hint: 'seats in use' },
	];

	return (
		<div className="cbin max-w-[1180px]">
			<div className="mb-4 grid grid-cols-4 gap-4">
				{tiles.map((t) => (
					<Card key={t.label} className="px-[18px] py-[17px]">
						<div className="font-medium text-[12px] text-ink-muted">{t.label}</div>
						<div className="my-[6px] font-semibold text-[27px] tracking-[-0.02em]">
							{t.value ?? '—'}
						</div>
						<div className="text-[12px] text-ink-faint">{t.hint}</div>
					</Card>
				))}
			</div>
			<Card>
				<CardHeader
					title="Audit log"
					action={
						<Link to="/audit" className="text-[12px]">
							View all →
						</Link>
					}
				/>
				{audit.data?.length ? (
					audit.data.slice(0, 6).map((e) => (
						<div
							key={e.id}
							className="grid grid-cols-[190px_1fr_160px] items-center gap-3.5 border-ink/5 border-b px-5 py-3 last:border-b-0"
						>
							<span className="font-medium text-[12.5px]">{e.action}</span>
							<span className="truncate text-[12.5px] text-ink-secondary">
								{e.detail ? JSON.stringify(e.detail) : '—'}
							</span>
							<span className="truncate text-right font-mono text-[11px] text-ink-faint">
								{e.actor}
							</span>
						</div>
					))
				) : (
					<EmptyState>Every state change lands here, with its actor.</EmptyState>
				)}
			</Card>
		</div>
	);
}
