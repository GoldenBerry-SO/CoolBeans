// ABOUTME: Overview page (PRD §16) — stat columns, validation traffic, recent activity, audit preview.
// ABOUTME: Stats from GET /admin/stats; the chart from GET /admin/validations; activity from /admin/audit.

import { Link } from '@tanstack/react-router';
import { Card, EmptyState } from '../components/ui.js';
import { actionVerb, detailHighlight, formatDetail } from '../lib/audit-format.js';
import { useAudit, useStats, useValidations, type ValidationDay } from '../lib/queries.js';
import type { AuditEntry } from '../lib/types.js';

/** Bars for the 16-day validation window. A day with no traffic still gets a slot. */
function ValidationChart({ days }: { days: ValidationDay[] }) {
	const peak = Math.max(...days.map((d) => d.count), 1);
	const total = days.reduce((sum, d) => sum + d.count, 0);
	if (total === 0) {
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
						// A day with traffic keeps a visible sliver rather than vanishing.
						style={{ height: `${d.count === 0 ? 0 : Math.max((d.count / peak) * 100, 4)}%` }}
					/>
					<div className="-translate-x-1/2 pointer-events-none absolute bottom-full left-1/2 mb-1 hidden whitespace-nowrap rounded-[5px] bg-ink px-2 py-1 font-mono text-[11px] text-white group-hover:block">
						{d.day} · {d.count}
					</div>
				</div>
			))}
		</div>
	);
}

function actionColor(action: string): string {
	if (action.startsWith('license.issued') || action.startsWith('license.enabled'))
		return 'var(--color-positive-deep)';
	if (action.startsWith('license.disabled')) return 'var(--color-danger)';
	return 'var(--color-ink-secondary)';
}

function activityDot(action: string): string {
	if (action.startsWith('license.issued')) return 'var(--color-positive)';
	if (action.startsWith('license.disabled')) return 'var(--color-danger)';
	if (action.startsWith('instance.')) return '#2fa89b';
	return 'var(--color-ink-faint)';
}

function AuditRow({ entry }: { entry: AuditEntry }) {
	return (
		<div className="grid grid-cols-[170px_1fr_170px] items-center gap-3.5 border-ink/5 border-b px-5 py-3 last:border-b-0">
			<span
				className="font-medium font-mono text-[11.5px]"
				style={{ color: actionColor(entry.action) }}
			>
				{entry.action}
			</span>
			<span className="truncate text-[12.5px] text-ink-secondary">{formatDetail(entry)}</span>
			<span className="truncate text-right font-mono text-[11px] text-ink-faint">
				{entry.actor}
			</span>
		</div>
	);
}

export function OverviewPage() {
	const stats = useStats();
	const audit = useAudit();
	const validations = useValidations();
	const tiles = [
		{ label: 'Products', value: stats.data?.products, hint: 'onboarded' },
		{ label: 'Active licenses', value: stats.data?.active_licenses, hint: 'across all products' },
		{ label: 'Total licenses', value: stats.data?.total_licenses, hint: 'issued all-time' },
		{ label: 'Live activations', value: stats.data?.live_activations, hint: 'seats in use' },
	];

	return (
		<div className="cbin">
			<div className="mb-[30px] grid grid-cols-4 gap-6">
				{tiles.map((t) => (
					<div key={t.label} className="border-ink/7 border-r py-0.5 pr-5 last:border-r-0">
						<div className="font-medium text-[12px] text-ink-muted">{t.label}</div>
						<div className="mt-1.5 mb-[3px] font-semibold text-[27px] tracking-[-0.02em]">
							{t.value ?? '—'}
						</div>
						<div className="font-mono text-[11.5px] text-ink-faint">{t.hint}</div>
					</div>
				))}
			</div>

			<div className="mb-4 grid grid-cols-[1.5fr_1fr] gap-4">
				<Card className="px-5 pt-[18px] pb-4">
					<div className="mb-[18px] flex items-baseline justify-between">
						<div>
							<div className="font-semibold text-[13px]">Validations</div>
							<div className="text-[11.5px] text-ink-faint">
								last 16 days · {validations.data?.reduce((s, d) => s + d.count, 0) ?? 0} checks
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
											{a.actor} · {a.created_at}
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

			<Card className="overflow-hidden">
				<div className="flex items-center justify-between border-ink/8 border-b px-5 py-[15px]">
					<div className="font-semibold text-[13px]">Audit log</div>
					<Link to="/audit" className="text-[12px]">
						View all →
					</Link>
				</div>
				{audit.data?.length ? (
					audit.data.slice(0, 4).map((e) => <AuditRow key={e.id} entry={e} />)
				) : (
					<EmptyState>Every state change lands here, with its actor.</EmptyState>
				)}
			</Card>
		</div>
	);
}
