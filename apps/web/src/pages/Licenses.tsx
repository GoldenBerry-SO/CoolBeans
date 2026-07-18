// ABOUTME: Licenses page (PRD §16) — live key table with status/product filters and disable/enable.
// ABOUTME: The Issue key dialog issues a manual key; the table refreshes on success.

import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { Dialog, Field, inputClass } from '../components/Dialog.js';
import {
	AccentButton,
	Card,
	EmptyState,
	SecondaryButton,
	StatusPill,
	TableHead,
	TierText,
} from '../components/ui.js';
import { useIssueKey, useLicenses, useProducts, useSetLicenseStatus } from '../lib/queries.js';

const FILTERS = ['all', 'active', 'disabled'] as const;

export function LicensesPage() {
	const products = useProducts();
	const [product, setProduct] = useState<string | null>(null);
	const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
	const [showIssue, setShowIssue] = useState(false);

	useEffect(() => {
		if (!product && products.data?.length) setProduct(products.data[0].slug);
	}, [product, products.data]);

	const licenses = useLicenses(product, filter);
	const setStatus = useSetLicenseStatus();

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
				<select
					value={product ?? ''}
					onChange={(e) => setProduct(e.target.value)}
					className="cursor-pointer rounded-[10px] border border-ink/12 bg-card px-3 py-2.5 text-[13px]"
				>
					{products.data?.map((p) => (
						<option key={p.slug} value={p.slug}>
							{p.name}
						</option>
					))}
				</select>
				<div className="flex-1" />
				<div className="font-mono text-[12.5px] text-ink-faint">
					{licenses.data?.length ?? 0} keys
				</div>
				<AccentButton onClick={() => setShowIssue(true)}>Issue key</AccentButton>
			</div>

			<Card className="overflow-hidden">
				<TableHead
					gridClass="grid-cols-[1.9fr_0.8fr_0.8fr_0.6fr_1fr]"
					columns={['License key', 'Tier', 'Status', 'Seats', '']}
				/>
				{licenses.isLoading ? (
					<EmptyState>Loading…</EmptyState>
				) : licenses.data?.length ? (
					licenses.data.map((l) => (
						<div
							key={l.id}
							className="grid grid-cols-[1.9fr_0.8fr_0.8fr_0.6fr_1fr] items-center gap-3.5 border-ink/5 border-b px-[18px] py-[13px] text-[13px] last:border-b-0"
						>
							<span className="font-mono font-medium text-[12.5px]">{l.key}</span>
							<TierText tier={l.tier} />
							<StatusPill status={l.status} />
							<span className="font-mono text-ink-secondary">
								{l.live_seats}/{l.activation_limit}
							</span>
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
					))
				) : (
					<EmptyState>No keys yet. Issue one from here or let a checkout do it.</EmptyState>
				)}
			</Card>

			{showIssue && product ? (
				<IssueKeyDialog
					product={product}
					products={products.data ?? []}
					onClose={() => setShowIssue(false)}
				/>
			) : null}
		</div>
	);
}

function IssueKeyDialog({
	product,
	products,
	onClose,
}: {
	product: string;
	products: { slug: string; name: string }[];
	onClose: () => void;
}) {
	const [slug, setSlug] = useState(product);
	const [email, setEmail] = useState('');
	const [tier, setTier] = useState('lifetime');
	const issue = useIssueKey();

	if (issue.data) {
		return (
			<Dialog
				title="Key issued"
				lede="Copy it now, or resend the email from the license page."
				onClose={onClose}
			>
				<div className="flex items-center gap-2.5 rounded-[11px] border border-ink/9 bg-fill-soft px-3.5 py-3">
					<span className="flex-1 font-mono font-semibold text-[15px]">{issue.data.key}</span>
					<SecondaryButton
						className="px-2.5 py-1 text-[12px]"
						onClick={() => navigator.clipboard.writeText(issue.data?.key ?? '')}
					>
						Copy
					</SecondaryButton>
				</div>
				<AccentButton className="mt-4 w-full justify-center" onClick={onClose}>
					Done
				</AccentButton>
			</Dialog>
		);
	}

	return (
		<Dialog
			title="Issue a key"
			lede="For comps, reissues, or testing. This creates a manual license."
			onClose={onClose}
		>
			<Field label="Product">
				<select value={slug} onChange={(e) => setSlug(e.target.value)} className={inputClass}>
					{products.map((p) => (
						<option key={p.slug} value={p.slug}>
							{p.name}
						</option>
					))}
				</select>
			</Field>
			<Field label="Customer email">
				<input
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="buyer@example.com"
					className={inputClass}
				/>
			</Field>
			<Field label="Tier">
				<select value={tier} onChange={(e) => setTier(e.target.value)} className={inputClass}>
					<option value="lifetime">Lifetime</option>
					<option value="yearly">Yearly</option>
					<option value="trial">Trial</option>
				</select>
			</Field>
			{issue.error ? (
				<p className="mb-2 text-[12.5px] text-danger">{(issue.error as Error).message}</p>
			) : null}
			<div className="mt-2 flex justify-end gap-2.5">
				<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
				<AccentButton onClick={() => issue.mutate({ product: slug, email, tier })}>
					{issue.isPending ? 'Issuing…' : 'Issue key'}
				</AccentButton>
			</div>
		</Dialog>
	);
}
