// ABOUTME: Licenses page (PRD §16) — key table across products with status/product filters.
// ABOUTME: Rows carry product identity, tier, seats, and buyer; disable/enable acts inline.

import { clsx } from 'clsx';
import { useState } from 'react';
import {
	Card,
	EmptyState,
	SecondaryButton,
	StatusPill,
	TableHead,
	TierText,
} from '../components/ui.js';
import { useLicensesAcross, useProducts, useSetLicenseStatus } from '../lib/queries.js';
import { productColor, useScope } from '../lib/scope.js';

const FILTERS = ['all', 'active', 'disabled'] as const;
const GRID = 'grid-cols-[1.7fr_1fr_0.85fr_0.85fr_0.6fr_1.4fr_auto]';

export function LicensesPage() {
	const products = useProducts();
	const { scope } = useScope();
	const [productFilter, setProductFilter] = useState('all');
	const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');

	const effective = scope !== 'all' ? scope : productFilter;
	const slugs = (products.data ?? [])
		.map((p) => p.slug)
		.filter((s) => effective === 'all' || s === effective);
	const licenses = useLicensesAcross(slugs, filter);
	const setStatus = useSetLicenseStatus();

	const byProduct = new Map(
		(products.data ?? []).map((p, i) => [p.slug, { name: p.name, color: productColor(i) }]),
	);

	return (
		<div className="cbin">
			<div className="mb-4 flex flex-wrap items-center gap-2.5">
				<div className="flex gap-[3px] rounded-[10px] bg-track p-1">
					{FILTERS.map((f) => (
						<button
							key={f}
							type="button"
							onClick={() => setFilter(f)}
							className={clsx(
								'cursor-pointer rounded-[7px] border-none px-[13px] py-1.5 font-medium text-[12.5px] capitalize',
								filter === f
									? 'bg-card text-ink shadow-[0_1px_2px_rgba(26,26,25,0.12)]'
									: 'bg-transparent text-ink-muted',
							)}
						>
							{f}
						</button>
					))}
				</div>
				{scope === 'all' ? (
					<select
						value={productFilter}
						onChange={(e) => setProductFilter(e.target.value)}
						className="cursor-pointer rounded-[10px] border border-ink/12 bg-card px-3 py-[9px] text-[13px]"
					>
						<option value="all">All products</option>
						{products.data?.map((p) => (
							<option key={p.slug} value={p.slug}>
								{p.name}
							</option>
						))}
					</select>
				) : null}
				<div className="flex-1" />
				<div className="font-mono text-[12.5px] text-ink-faint">{licenses.data.length} keys</div>
			</div>

			<Card className="overflow-hidden">
				<TableHead
					gridClass={GRID}
					columns={['License key', 'Product', 'Tier', 'Status', 'Seats', 'Customer', '']}
				/>
				{licenses.isLoading ? (
					<EmptyState>Loading…</EmptyState>
				) : licenses.data.length ? (
					licenses.data.map((l) => {
						const p = byProduct.get(l.product);
						return (
							<div
								key={l.id}
								className={clsx(
									'grid items-center gap-3.5 border-ink/5 border-b px-[18px] py-[13px] text-[13px] last:border-b-0 hover:bg-ink/2',
									GRID,
								)}
							>
								<span className="font-medium font-mono text-[12.5px] tracking-[-0.01em]">
									{l.key}
								</span>
								<span className="flex items-center gap-[7px] overflow-hidden text-ink-secondary">
									<span
										className="h-[7px] w-[7px] flex-none rounded-[2px]"
										style={{ background: p?.color ?? '#9a9a92' }}
									/>
									<span className="truncate">{p?.name ?? l.product}</span>
								</span>
								<TierText tier={l.tier} />
								<StatusPill status={l.status} />
								<span
									className={clsx(
										'font-medium font-mono text-[12px]',
										l.live_seats >= l.activation_limit ? 'text-warn' : 'text-ink-secondary',
									)}
								>
									{l.live_seats}/{l.activation_limit}
								</span>
								<span className="truncate text-ink-secondary">{l.customer_email ?? '—'}</span>
								<div className="flex justify-end">
									{l.status === 'active' ? (
										<SecondaryButton
											destructive
											className="px-2.5 py-1 text-[11.5px]"
											onClick={() => setStatus.mutate({ key: l.key, action: 'disable' })}
										>
											Disable
										</SecondaryButton>
									) : (
										<SecondaryButton
											className="px-2.5 py-1 text-[11.5px]"
											onClick={() => setStatus.mutate({ key: l.key, action: 'enable' })}
										>
											Re-enable
										</SecondaryButton>
									)}
								</div>
							</div>
						);
					})
				) : (
					<EmptyState>No keys here. Nice and quiet.</EmptyState>
				)}
			</Card>
		</div>
	);
}
