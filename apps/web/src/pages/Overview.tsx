// ABOUTME: Overview page (PRD §16) — stat columns, validation traffic, recent activity, recent licences.
// ABOUTME: Stats from GET /admin/stats; chart from /admin/validations; licences from /admin/licenses.

import { Link } from '@tanstack/react-router';
import { Card, EmptyState, KindText } from '../components/ui.js';
import { actionVerb, detailHighlight } from '../lib/audit-format.js';
import { formatDateTime } from '../lib/dates.js';
import {
	useAudit,
	useProducts,
	useRecentLicenses,
	useStats,
	useValidations,
	type ValidationDay,
} from '../lib/queries.js';

/**
 * Bars for the 16-day window. The bar is DISTINCT LICENCES seen that day (#101): raw check
 * volume is launches × devices, which one chatty install inflates, so it lives in the
 * tooltip instead. The red strip underneath marks days with refused checks — lapsed or
 * revoked keys still phoning home. Days recorded before the seen-set existed show zero
 * licences while still carrying checks in the tooltip.
 */
function ValidationChart({ days }: { days: ValidationDay[] }) {
	const peak = Math.max(...days.map((d) => d.licenses), 1);
	const peakRefused = Math.max(...days.map((d) => d.refused), 1);
	const totalChecks = days.reduce((sum, d) => sum + d.checks, 0);
	if (totalChecks === 0) {
		return (
			<div className="flex h-[150px] items-center justify-center text-[12.5px] text-ink-faint">
				No validations yet. This fills in as customers run your software.
			</div>
		);
	}
	return (
		<div className="flex h-[150px] items-end gap-[6px]">
			{days.map((d) => (
				// h-full matters: without it the column is content-height and a
				// percentage bar resolves against zero, so nothing draws.
				<div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
					<div
						className="w-full rounded-[3px] bg-meter-ok transition-[height]"
						// A day with a customer keeps a visible sliver rather than vanishing.
						style={{
							height: `${d.licenses === 0 ? 0 : Math.max((d.licenses / peak) * 92, 4)}%`,
						}}
					/>
					{d.refused > 0 ? (
						<div
							className="mt-[2px] w-full rounded-[2px] bg-danger"
							style={{ height: `${Math.max((d.refused / peakRefused) * 8, 3)}px` }}
						/>
					) : (
						<div className="mt-[2px] h-[3px] w-full" />
					)}
					<div className="-translate-x-1/2 pointer-events-none absolute bottom-full left-1/2 mb-1 hidden whitespace-nowrap rounded-[5px] bg-ink px-2 py-1 font-mono text-[11px] text-white group-hover:block">
						{d.day} · {d.licenses} {d.licenses === 1 ? 'licence' : 'licences'} · {d.checks} checks
						{d.refused > 0 ? ` · ${d.refused} refused` : ''}
					</div>
				</div>
			))}
		</div>
	);
}

function activityDot(action: string): string {
	if (action.startsWith('license.issued')) return 'var(--color-positive)';
	if (action.startsWith('license.disabled')) return 'var(--color-danger)';
	if (action.startsWith('activation.')) return '#2fa89b';
	return 'var(--color-ink-faint)';
}

export function OverviewPage() {
	const stats = useStats();
	const audit = useAudit();
	const validations = useValidations();
	const recent = useRecentLicenses(6);
	const products = useProducts();
	// Licences carry their product slug; resolve it to the display name, falling back to the
	// slug for a product that is no longer in the list (for example archived).
	const nameOf = (slug: string) => products.data?.find((p) => p.slug === slug)?.name ?? slug;
	const tiles = [
		{ label: 'Products', value: stats.data?.products, hint: 'onboarded' },
		{ label: 'Active licenses', value: stats.data?.active_licenses, hint: 'across all products' },
		{ label: 'Total licenses', value: stats.data?.total_licenses, hint: 'issued all-time' },
		{
			label: 'Live activations',
			value: stats.data?.live_activations,
			// The pulse a vendor actually watches (#99): did anyone claim a seat lately?
			hint:
				stats.data === undefined
					? 'seats in use'
					: `seats in use · ${stats.data.activations_7d} this week`,
		},
	];

	return (
		<div className="cbin">
			<div className="mb-6 grid grid-cols-2 gap-x-4 gap-y-5 sm:mb-[30px] sm:grid-cols-4 sm:gap-6">
				{tiles.map((t) => (
					<div
						key={t.label}
						className="py-0.5 pr-3 sm:border-ink/7 sm:border-r sm:pr-5 sm:last:border-r-0"
					>
						<div className="font-medium text-[12px] text-ink-muted">{t.label}</div>
						<div className="mt-1.5 mb-[3px] font-semibold text-[27px] tracking-[-0.02em]">
							{t.value ?? '—'}
						</div>
						<div className="font-mono text-[11.5px] text-ink-faint">{t.hint}</div>
					</div>
				))}
			</div>

			<div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
				<Card className="px-5 pt-[18px] pb-4">
					<div className="mb-[18px] flex items-baseline justify-between">
						<div>
							<div className="font-semibold text-[13px]">Licences seen</div>
							<div className="text-[11.5px] text-ink-faint">
								last 16 days · {validations.data?.reduce((s, d) => s + d.checks, 0) ?? 0} checks
								{(validations.data?.reduce((s, d) => s + d.refused, 0) ?? 0) > 0
									? ` · ${validations.data?.reduce((s, d) => s + d.refused, 0)} refused`
									: ''}
							</div>
						</div>
					</div>
					{validations.data ? (
						<ValidationChart days={validations.data} />
					) : (
						<div className="flex h-[150px] items-center justify-center text-[12.5px] text-ink-faint">
							Loading…
						</div>
					)}
				</Card>
				<Card className="px-5 py-[18px]">
					<div className="mb-[15px] font-semibold text-[13px]">Recent activity</div>
					{audit.data?.length ? (
						<div className="flex flex-col gap-3.5">
							{audit.data.slice(0, 5).map((a) => (
								<div key={a.id} className="flex items-start gap-[11px]">
									<span
										className="mt-[5px] h-2 w-2 flex-none rounded-full"
										style={{ background: activityDot(a.action) }}
									/>
									<div className="min-w-0 flex-1">
										<div className="text-[12.5px] leading-[1.4]">
											{actionVerb(a.action)}{' '}
											{detailHighlight(a) ? (
												<span className="font-mono text-[11.5px] text-positive">
													{detailHighlight(a)}
												</span>
											) : null}
										</div>
										<div className="truncate text-[11px] text-ink-faint">
											{a.actor} · {formatDateTime(a.created_at)}
										</div>
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="text-[12.5px] text-ink-faint">Nothing yet. Nice and quiet.</div>
					)}
				</Card>
			</div>

			<Card className="overflow-x-auto">
				<div className="flex min-w-[560px] items-center justify-between border-ink/8 border-b px-5 py-[15px]">
					<div className="font-semibold text-[13px]">Recent licenses</div>
					<Link to="/licenses" className="text-[12px]">
						View all →
					</Link>
				</div>
				{recent.data?.length ? (
					recent.data.map((l) => (
						<div
							key={l.id}
							className="grid min-w-[560px] grid-cols-[150px_1fr_84px_140px] items-center gap-3.5 border-ink/5 border-b px-5 py-3 last:border-b-0"
						>
							<span className="truncate font-medium text-[12.5px]">{nameOf(l.product)}</span>
							<span className="truncate text-[12.5px] text-ink-secondary">
								{l.customer_email ?? 'no buyer on record'}
							</span>
							<span className="text-[11.5px]">
								<KindText kind={l.kind} />
							</span>
							<span className="truncate text-right font-mono text-[11px] text-ink-faint">
								{formatDateTime(l.created_at)}
							</span>
						</div>
					))
				) : (
					<EmptyState>Issued keys land here as customers buy.</EmptyState>
				)}
			</Card>
		</div>
	);
}
