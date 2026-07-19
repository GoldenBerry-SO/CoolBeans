// ABOUTME: Usage page — metered quotas per key with progress bars and limit badges.
// ABOUTME: Meters follow docs/DESIGN.md (warn near the limit, danger over it).

import { clsx } from 'clsx';
import { Card, CardHeader, EmptyState } from '../components/ui.js';
import { useUsage } from '../lib/queries.js';
import { useScope } from '../lib/scope.js';

const GRID = 'grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[1.4fr_0.8fr_2fr_0.8fr]';

function Meter({ current, limit }: { current: number; limit: number | null }) {
	if (limit === null) return <div className="text-[12px] text-ink-faint">no cap</div>;
	const pct = Math.min(100, Math.round((current / limit) * 100));
	const over = current >= limit;
	return (
		<div className="h-2 overflow-hidden rounded-[5px] bg-track">
			<div
				className={clsx(
					'h-full rounded-[5px]',
					over ? 'bg-danger-cue' : pct > 85 ? 'bg-meter-near' : 'bg-meter-ok',
				)}
				style={{ width: `${pct}%` }}
			/>
		</div>
	);
}

function Badge({ current, limit }: { current: number; limit: number | null }) {
	if (limit === null) return null;
	const pct = Math.min(100, Math.round((current / limit) * 100));
	const over = current >= limit;
	return (
		<span
			className={clsx(
				'inline-flex rounded-full px-[9px] py-[3px] font-semibold text-[11px]',
				over
					? 'bg-danger-tint text-danger'
					: pct > 85
						? 'bg-warn-tint text-warn'
						: 'bg-positive-tint text-positive-deep',
			)}
		>
			{over ? 'Over limit' : pct > 85 ? `${pct}%` : 'OK'}
		</span>
	);
}

export function UsagePage() {
	const usage = useUsage();
	const { scope, query } = useScope();
	const needle = query.trim().toLowerCase();
	const rows = (usage.data ?? [])
		.filter((u) => scope === 'all' || u.product === scope)
		.filter((u) => !needle || u.key.toLowerCase().includes(needle));

	return (
		<div className="cbin">
			<Card className="overflow-hidden">
				<CardHeader
					title={
						<>
							Metered usage{' '}
							<span className="font-normal text-ink-faint">· enforced atomically per key</span>
						</>
					}
				/>
				{usage.isLoading ? (
					<EmptyState>Loading…</EmptyState>
				) : rows.length ? (
					rows.map((u) => (
						<div
							key={`${u.key}-${u.metric}`}
							className={clsx(
								'grid items-center gap-x-4 gap-y-3 border-ink/5 border-b px-4 py-[15px] last:border-b-0 sm:gap-[18px] sm:px-5',
								GRID,
							)}
						>
							<div>
								<div className="font-medium font-mono text-[12.5px]">{u.key}</div>
								<div className="text-[11px] text-ink-faint">
									{u.product} · {u.metric}
								</div>
							</div>
							<div
								className={clsx(
									'font-mono text-[12.5px]',
									u.limit !== null && u.current >= u.limit ? 'text-danger' : 'text-ink-secondary',
								)}
							>
								{u.current.toLocaleString()}
								{u.limit === null ? '' : ` / ${u.limit.toLocaleString()}`}
							</div>
							<Meter current={u.current} limit={u.limit} />
							<div className="text-right">
								<Badge current={u.current} limit={u.limit} />
							</div>
						</div>
					))
				) : (
					<EmptyState>No metered products yet. Define a metric and counters land here.</EmptyState>
				)}
			</Card>
		</div>
	);
}
