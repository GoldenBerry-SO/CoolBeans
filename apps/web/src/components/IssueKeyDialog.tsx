// ABOUTME: The Issue key dialog — manual license issuance from the header's primary action.
// ABOUTME: On success the key shows once in a mono well with a copy button (docs/DESIGN.md).

import { useEffect, useState } from 'react';
import { entitlementsPayload, parseEntitlements } from '../lib/entitlements.js';
import { useIssueKey, useProducts } from '../lib/queries.js';
import { Dialog, Field, inputClass } from './Dialog.js';
import { AccentButton, SecondaryButton } from './ui.js';

/**
 * Plain words per kind, because this is THE decision for a vendor selling by duration (a
 * lifetime and a yearly, say) and the dropdown alone assumes the vocabulary is known.
 */
const KIND_HINTS: Record<string, string> = {
	perpetual: 'Bought once, never expires. A lifetime licence.',
	subscription:
		'Expires and renews. Defaults to one year from today; the app locks when it lapses.',
	trial: 'Time-boxed evaluation. Ends exactly on time, no offline grace.',
};

export function IssueKeyDialog({ onClose }: { onClose: () => void }) {
	const products = useProducts();
	const [slug, setSlug] = useState('');
	const [email, setEmail] = useState('');
	const [kind, setKind] = useState('subscription');
	const [plan, setPlan] = useState('');
	// Blank inherits the product's limit, which is what every hand-issued key used to get.
	const [seats, setSeats] = useState('');
	// What this licence unlocks. Normally a price decides; a comped or replacement key has no
	// price, so without this a comped Pro key is indistinguishable from Basic.
	const [capabilities, setCapabilities] = useState('');
	const parsed = parseEntitlements(capabilities);
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
			wide
			footer={
				<>
					<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
					{/* Disabled rather than a no-op click: the guard was already here, but with
					    the button still enabled a click on an empty form did nothing at all and
					    said nothing about why. */}
					<AccentButton
						disabled={!email || !slug || !!parsed.error || issue.isPending}
						onClick={() =>
							email &&
							slug &&
							!parsed.error &&
							issue.mutate({
								product: slug,
								email,
								kind,
								plan: plan || undefined,
								activation_limit: seats ? Number(seats) : undefined,
								entitlements: entitlementsPayload(capabilities, false),
							})
						}
					>
						{issue.isPending ? 'Issuing…' : 'Issue key'}
					</AccentButton>
				</>
			}
		>
			<div className="grid grid-cols-1 gap-[15px] sm:grid-cols-2">
				<Field label="Product">
					<select value={slug} onChange={(e) => setSlug(e.target.value)} className={inputClass}>
						{products.data?.map((p) => (
							<option key={p.slug} value={p.slug}>
								{p.name}
							</option>
						))}
					</select>
				</Field>
				<Field label="Kind" hint={KIND_HINTS[kind]}>
					<select value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass}>
						<option value="perpetual">Perpetual</option>
						<option value="subscription">Subscription</option>
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
				<Field
					label="Plan label (optional)"
					hint="What the customer calls this, e.g. Pro. Display only — never gate a feature on it."
				>
					<input
						value={plan}
						onChange={(e) => setPlan(e.target.value)}
						placeholder="Pro"
						className={inputClass}
					/>
				</Field>
				<Field label="Seats (optional)" hint="Blank inherits the product's limit.">
					<input
						value={seats}
						onChange={(e) => setSeats(e.target.value.replace(/[^0-9]/g, ''))}
						placeholder="10"
						inputMode="numeric"
						className={inputClass}
					/>
				</Field>
				<Field
					label="What it unlocks (optional)"
					hint="Names you invent for features that differ between your tiers — your app checks the same names via state.entitlements. A bare name means on; name=value sets a limit. Leave blank if every licence unlocks the same app."
				>
					<input
						value={capabilities}
						onChange={(e) => setCapabilities(e.target.value)}
						placeholder="pro_reports, seat_limit=5"
						className={inputClass}
					/>
				</Field>
			</div>
			{parsed.error ? <p className="m-0 text-[12.5px] text-danger">{parsed.error}</p> : null}
			{issue.error ? (
				<p className="m-0 text-[12.5px] text-danger">{(issue.error as Error).message}</p>
			) : null}
		</Dialog>
	);
}
