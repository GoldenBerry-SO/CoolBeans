// ABOUTME: License detail (PRD §16, design v2) — the key, its facts, seats, usage and timeline.
// ABOUTME: Deactivating a seat here frees it immediately, same as the customer portal.

import { Link, useParams } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { useState } from 'react';
import { Dialog, Field, inputClass } from '../components/Dialog.js';
import { OfflineActivationDialog } from '../components/OfflineActivationDialog.js';
import {
	AccentButton,
	Card,
	CardHeader,
	EmptyState,
	SecondaryButton,
	StatusPill,
} from '../components/ui.js';
import { formatDate, formatDateTime } from '../lib/dates.js';
import { deviceLabel } from '../lib/device-label.js';
import { formatEntitlements } from '../lib/entitlements.js';
import { useExtendLicense, useLicenseDetail, useSetLicenseStatus } from '../lib/queries.js';

/** Default the extend picker to one year past the current expiry (or today, if none). */
function defaultExtendDate(expiresAt: string | null): string {
	const base = expiresAt ? new Date(expiresAt) : new Date();
	base.setUTCFullYear(base.getUTCFullYear() + 1);
	return base.toISOString().slice(0, 10);
}

function ExtendDialog({
	licenseKey,
	expiresAt,
	onClose,
}: {
	licenseKey: string;
	expiresAt: string | null;
	onClose: () => void;
}) {
	const extend = useExtendLicense();
	const [date, setDate] = useState(defaultExtendDate(expiresAt));
	return (
		<Dialog
			title="Extend expiry"
			lede="For manual renewals — the customer paid, the licence lives on."
			onClose={onClose}
			footer={
				<>
					<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
					<AccentButton
						disabled={!date || extend.isPending}
						onClick={() =>
							extend.mutate(
								// End of the chosen day: an expiry the operator picked should not
								// lapse at midnight the moment that date arrives.
								{ key: licenseKey, expires_at: `${date}T23:59:59.000Z` },
								{ onSuccess: onClose },
							)
						}
					>
						{extend.isPending ? 'Extending…' : 'Extend'}
					</AccentButton>
				</>
			}
		>
			<Field
				label="New expiry date"
				hint="Any future date. The running app picks it up on its next online check; until then a cached token keeps its old date, which the offline buffer already covers."
			>
				<input
					type="date"
					value={date}
					onChange={(e) => setDate(e.target.value)}
					className={inputClass}
				/>
			</Field>
		</Dialog>
	);
}

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
	const [extending, setExtending] = useState(false);

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
			{extending ? (
				<ExtendDialog
					licenseKey={license.key}
					expiresAt={license.expires_at}
					onClose={() => setExtending(false)}
				/>
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
					{/* Perpetual has nothing to extend; a lapsed trial does (the server re-enables
					    it when the new date supersedes the lapse), so kind is the only gate. */}
					{license.kind !== 'perpetual' ? (
						<SecondaryButton onClick={() => setExtending(true)}>Extend expiry</SecondaryButton>
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

			<Card className="mb-4 grid grid-cols-2 overflow-hidden sm:grid-cols-5">
				<Fact label="Kind" value={license.kind} />
				{/* The vendor's own label for what was sold ("Pro monthly"). Several plans can share
				    one kind, so without this the console cannot tell two subscriptions apart. */}
				<Fact label="Plan" value={license.plan ?? '—'} />
				<Fact label="Product" value={license.product} />
				<Fact
					label="Expires"
					value={
						license.expires_at
							? formatDate(license.expires_at)
							: license.kind === 'perpetual'
								? 'Never (perpetual)'
								: '—'
					}
					mono
				/>
				<Fact label="Seats" value={`${live.length}/${license.activation_limit}`} mono />
			</Card>

			{/* What this licence unlocks. Without it an operator can set capabilities at issue
			    time and never see them again, so a comped Pro key reads as Basic everywhere. */}
			{license.entitlements ? (
				<Card className="mb-4 overflow-hidden px-[18px] py-3">
					<span className="mr-3 font-semibold text-[12px] text-ink-secondary">Unlocks</span>
					<span className="font-mono text-[12.5px] text-ink-body">
						{formatEntitlements(license.entitlements)}
					</span>
				</Card>
			) : null}

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
									{/* The full name (often a machine fingerprint) stays reachable via hover;
									    the row leads with something a human can tell apart. */}
									<div className="font-medium text-[13px]" title={a.name}>
										{deviceLabel(a.name)}
									</div>
									<div
										className="truncate font-mono text-[10.5px] text-ink-faint"
										title={a.instance_id}
									>
										{a.instance_id.slice(0, 8)}… · activated {formatDate(a.created_at)}
										{a.last_validated_at
											? ` · validated ${formatDateTime(a.last_validated_at)}`
											: ''}
									</div>
								</div>
								{a.deactivated_at ? (
									<span className="text-[11.5px] text-ink-faint italic">freed</span>
								) : null}
								<SecondaryButton
									className="px-2 py-[4px] font-mono text-[10.5px]"
									onClick={() => navigator.clipboard.writeText(a.instance_id)}
								>
									Copy id
								</SecondaryButton>
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
									<div className="mt-1.5 text-[10.5px] text-ink-faint">
										resets {formatDate(u.resets_at)}
									</div>
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
