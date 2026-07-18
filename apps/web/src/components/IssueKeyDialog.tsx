// ABOUTME: The Issue key dialog — manual license issuance from the header's primary action.
// ABOUTME: On success the key shows once in a mono well with a copy button (docs/DESIGN.md).

import { useEffect, useState } from 'react';
import { useIssueKey, useProducts } from '../lib/queries.js';
import { Dialog, Field, inputClass } from './Dialog.js';
import { AccentButton, SecondaryButton } from './ui.js';

export function IssueKeyDialog({ onClose }: { onClose: () => void }) {
	const products = useProducts();
	const [slug, setSlug] = useState('');
	const [email, setEmail] = useState('');
	const [tier, setTier] = useState('yearly');
	const issue = useIssueKey();

	useEffect(() => {
		if (!slug && products.data?.length) setSlug(products.data[0].slug);
	}, [slug, products.data]);

	if (issue.data) {
		return (
			<Dialog
				title="Key issued"
				lede="Copy it now, or resend the email from the license page."
				onClose={onClose}
				footer={
					<AccentButton onClick={onClose} className="justify-center">
						Done
					</AccentButton>
				}
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
			</Dialog>
		);
	}

	return (
		<Dialog
			title="Issue a key"
			lede="Manually issue a license — reissues, comps, or testing."
			onClose={onClose}
			footer={
				<>
					<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
					<AccentButton
						onClick={() => email && slug && issue.mutate({ product: slug, email, tier })}
					>
						{issue.isPending ? 'Issuing…' : 'Issue key'}
					</AccentButton>
				</>
			}
		>
			<Field label="Product">
				<select value={slug} onChange={(e) => setSlug(e.target.value)} className={inputClass}>
					{products.data?.map((p) => (
						<option key={p.slug} value={p.slug}>
							{p.name}
						</option>
					))}
				</select>
			</Field>
			<Field label="Tier">
				<select value={tier} onChange={(e) => setTier(e.target.value)} className={inputClass}>
					<option value="lifetime">Lifetime</option>
					<option value="yearly">Yearly</option>
					<option value="trial">Trial</option>
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
			{issue.error ? (
				<p className="m-0 text-[12.5px] text-danger">{(issue.error as Error).message}</p>
			) : null}
		</Dialog>
	);
}
