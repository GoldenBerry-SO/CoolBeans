// ABOUTME: Mint an activation for a machine that will never reach us (issue #57).
// ABOUTME: The operator pastes the device's fingerprint; the blob goes back by hand.

import { useState } from 'react';
import { useOfflineActivation } from '../lib/queries.js';
import { Dialog, Field, inputClass } from './Dialog.js';
import { AccentButton, SecondaryButton } from './ui.js';

export function OfflineActivationDialog({
	licenseKey,
	onClose,
}: {
	licenseKey: string;
	onClose: () => void;
}) {
	const [fingerprint, setFingerprint] = useState('');
	const issue = useOfflineActivation();

	if (issue.data) {
		return (
			<Dialog
				title="Activation ready"
				lede="Copy it now — this is the only time it is shown."
				onClose={onClose}
				footer={<AccentButton onClick={onClose}>Done</AccentButton>}
			>
				<textarea
					readOnly
					value={issue.data.token}
					rows={6}
					className={`${inputClass} resize-none break-all font-mono text-[11px]`}
				/>
				<SecondaryButton onClick={() => navigator.clipboard.writeText(issue.data.token)}>
					Copy activation
				</SecondaryButton>
				<p className="m-0 text-[12.5px] text-ink-faint">
					Send this to the customer to paste into the offline machine. It has taken a seat on this
					licence, and because that machine can never reach us it cannot be revoked before it
					expires.
				</p>
			</Dialog>
		);
	}

	return (
		<Dialog
			title="Offline activation"
			lede="For a machine with no internet access, now or ever."
			onClose={onClose}
			footer={
				<>
					<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
					<AccentButton
						disabled={!fingerprint.trim() || issue.isPending}
						onClick={() => issue.mutate({ key: licenseKey, fingerprint: fingerprint.trim() })}
					>
						{issue.isPending ? 'Creating…' : 'Create activation'}
					</AccentButton>
				</>
			}
		>
			<Field label="Device fingerprint">
				<input
					value={fingerprint}
					onChange={(e) => setFingerprint(e.target.value)}
					placeholder="Paste what the customer's app shows"
					className={inputClass}
				/>
			</Field>
			<p className="m-0 text-[12.5px] text-ink-faint">
				The customer's app shows this on its licence screen. Creating an activation consumes a seat,
				exactly as activating online would.
			</p>
		</Dialog>
	);
}
