// ABOUTME: License detail (PRD §16, design v2) — the key, its facts, seats, usage and timeline.
// ABOUTME: Deactivating a seat here frees it immediately, same as the customer portal.

import { Link, useParams } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { useState } from 'react';
import { OfflineActivationDialog } from '../components/OfflineActivationDialog.js';
import { Card, CardHeader, EmptyState, SecondaryButton, StatusPill } from '../components/ui.js';
import { useLicenseDetail, useSetLicenseStatus } from '../lib/queries.js';

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
	return (
		<div className="min-w-0 border-ink/6 border-r px-3 py-3.5 last:border-r-0 sm:px-4">
			<div className="font-medium text-[12px] text-ink-muted">{label}</div>
			<div
				className={clsx(
					'mt-1.5 break-words font-medium text-[14px]',
					mono && 'font-mono text-[12px] sm:text-[13px]',
				)}
			>
				{value}
			</div>
		</div>
	);
}

export function LicenseDetailPage() {
	const { key } = useParams({ strict: false }) as { key: string };
	const detail = useLicenseDetail(key ?? '');
	const setStatus = useSetLicenseStatus();
	const [offline, setOffline] = useState(false);

	if (detail.isLoading) return <EmptyState>Loading…</EmptyState>;
	if (!detail.data) return <EmptyState>No license with that key.</EmptyState>;

	const { license, activations, usage } = detail.data;
	// A floating seat is only held while its lease is current — an expired lease frees
	// the seat automatically, so counting it would overstate usage on floating products.
	const now = Date.now();
	const live = activations.filter(
		(a) =>
			!a.deactivated_at && (!a.lease_expires_at || new Date(a.lease_expires_at).getTime() > now),
	);

	return (
		<div className="cbin max-w-[1020px]">
			{offline ? (
				<OfflineActivationDialog licenseKey={license.key} onClose={() => setOffline(false)} />
			) : null}
			<Link
				to="/licenses"
				className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted hover:text-ink"
			>
				← All licenses
			</Link>

			<div className="mb-[22px] flex flex-wrap items-start gap-4">
				<div className="min-w-0 flex-1 basis-full sm:basis-auto">
					<div className="flex flex-wrap items-center gap-3">
						<span className="break-all font-mono font-semibold text-[18px] tracking-[-0.01em] sm:text-[22px]">
							{license.key}
						</span>
						<SecondaryButton
							className="px-2.5 py-[5px] font-mono text-[11.5px]"
							onClick={() => navigator.clipboard.writeText(license.key)}
						>
							Copy
						</SecondaryButton>
						<StatusPill status={license.status} />
					</div>
					<div className="mt-[7px] text-[13px] text-ink-muted">
						{license.customer_email ?? 'no buyer on record'}
					</div>
				</div>
				<div className="flex w-full gap-2.5 sm:w-auto">
					{license.status === 'active' ? (
						<SecondaryButton onClick={() => setOffline(true)}>Offline activation</SecondaryButton>
					) : null}
					{license.status === 'active' ? (
						<SecondaryButton
							destructive
							onClick={() => setStatus.mutate({ key: license.key, action: 'disable' })}
						>
							Disable key
						</SecondaryButton>
					) : (
						<SecondaryButton
							onClick={() => setStatus.mutate({ key: license.key, action: 'enable' })}
						>
							Re-enable key
						</SecondaryButton>
					)}
				</div>
			</div>

			<Card className="mb-4 grid grid-cols-2 overflow-hidden sm:grid-cols-4">
				<Fact label="Kind" value={license.kind} />
				<Fact label="Product" value={license.product} />
				<Fact
					label="Expires"
					value={license.expires_at ?? (license.kind === 'perpetual' ? 'Never (perpetual)' : '—')}
					mono
				/>
				<Fact label="Seats" value={`${live.length}/${license.activation_limit}`} mono />
			</Card>

			<div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
				<Card className="overflow-hidden">
					<CardHeader
						title="Activations"
						action={
							<span className="font-mono text-[12px] text-ink-muted">
								{live.length}/{license.activation_limit} seats
							</span>
						}
					/>
					{activations.length ? (
						activations.map((a) => (
							<div
								key={a.instance_id}
								className="flex items-center gap-3 border-ink/5 border-b px-[18px] py-[13px] last:border-b-0"
							>
								<span
									className={clsx(
										'h-[9px] w-[9px] flex-none rounded-full',
										a.deactivated_at ? 'bg-ink/25' : 'bg-positive',
									)}
								/>
								<div className="min-w-0 flex-1">
									<div className="font-medium text-[13px]">{a.name}</div>
									<div className="truncate font-mono text-[10.5px] text-ink-faint">
										{a.instance_id}
										{a.last_validated_at ? ` · validated ${a.last_validated_at}` : ''}
									</div>
								</div>
								{a.deactivated_at ? (
									<span className="text-[11.5px] text-ink-faint italic">freed</span>
								) : null}
							</div>
						))
					) : (
						<EmptyState>No live activations — every seat is free.</EmptyState>
					)}
				</Card>

				<Card className="px-[18px] py-4">
					<div className="mb-3.5 font-semibold text-[13px]">Usage</div>
					{usage.length ? (
						usage.map((u) => (
							<div key={u.metric} className="mb-3">
								<div className="mb-1.5 flex justify-between text-[12px]">
									<span className="text-ink-secondary">{u.metric}</span>
									<span className="font-mono text-ink-secondary">
										{u.current}
										{u.limit === null ? '' : ` / ${u.limit}`}
									</span>
								</div>
								{u.limit === null ? null : (
									<div className="h-[7px] overflow-hidden rounded-[5px] bg-track">
										<div
											className="h-full rounded-[5px] bg-meter-ok"
											style={{
												width: `${Math.min(100, Math.round((u.current / u.limit) * 100))}%`,
											}}
										/>
									</div>
								)}
								{u.resets_at ? (
									<div className="mt-1.5 text-[10.5px] text-ink-faint">resets {u.resets_at}</div>
								) : null}
							</div>
						))
					) : (
						<div className="text-[12.5px] text-ink-faint">No metered usage on this product.</div>
					)}
				</Card>
			</div>
		</div>
	);
}
