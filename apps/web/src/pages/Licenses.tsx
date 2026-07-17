// ABOUTME: Licenses page — status filter, product filter, and the key table.
// ABOUTME: Table columns follow docs/DESIGN.md; rows arrive with the dashboard data wiring.

import { clsx } from 'clsx';
import { useState } from 'react';
import { Card, EmptyState, TableHead } from '../components/ui.js';

const FILTERS = ['All', 'Active', 'Disabled'] as const;

export function LicensesPage() {
	const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');

	return (
		<div className="cbin max-w-[1180px]">
			<div className="mb-4 flex flex-wrap items-center gap-2.5">
				<div className="flex gap-[3px] rounded-[10px] bg-track p-1">
					{FILTERS.map((f) => (
						<button
							key={f}
							type="button"
							onClick={() => setFilter(f)}
							className={clsx(
								'cursor-pointer rounded-[7px] border-none px-[13px] py-1.5 font-medium text-[12.5px]',
								filter === f
									? 'bg-card text-ink shadow-[0_1px_2px_rgba(26,26,25,0.12)]'
									: 'bg-transparent text-ink-muted',
							)}
						>
							{f}
						</button>
					))}
				</div>
				<div className="flex-1" />
				<div className="font-mono text-[12.5px] text-ink-faint">0 keys</div>
			</div>
			<Card className="overflow-hidden">
				<TableHead
					gridClass="grid-cols-[1.7fr_1fr_0.85fr_0.85fr_0.6fr_1.4fr]"
					columns={['License key', 'Product', 'Tier', 'Status', 'Seats', 'Customer']}
				/>
				<EmptyState>No keys yet. Issue one from here or let a checkout do it.</EmptyState>
			</Card>
		</div>
	);
}
