// ABOUTME: Customer portal page (PRD §15) — key lookup, license view, and self-service seat freeing.
// ABOUTME: No login: the key is the credential. Deactivating a device frees a seat instantly.

import { useState } from 'react';
import { AccentButton, BeanMark, Card, SecondaryButton, StatusPill } from '../components/ui.js';
import { publicApi } from '../lib/api.js';

interface Device {
	instance_id: string;
	name: string;
	last_validated_at: string | null;
}
interface LookupResult {
	license: {
		key: string;
		status: 'active' | 'disabled';
		tier: string;
		product: string;
		expires_at: string | null;
	};
	download_url: string | null;
	activations: Device[];
}

export function PortalPage() {
	const [key, setKey] = useState('');
	const [result, setResult] = useState<LookupResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function lookup() {
		setError(null);
		setLoading(true);
		try {
			setResult(await publicApi<LookupResult>('POST', '/v1/portal/lookup', { license_key: key }));
		} catch {
			setError("We couldn't find that license key.");
		} finally {
			setLoading(false);
		}
	}

	async function deactivate(instanceId: string) {
		await publicApi('POST', '/v1/deactivate', { license_key: key, instance_id: instanceId });
		await lookup();
	}

	return (
		<div className="flex min-h-screen flex-col items-center px-5 pt-10 pb-16">
			<div className="mb-9 flex w-full max-w-[520px] items-center gap-2.5">
				<BeanMark size={30} />
				<span className="font-semibold text-[15px]">Manage your license</span>
			</div>

			{!result ? (
				<div className="cbin w-full max-w-[420px] rounded-2xl border border-ink/10 bg-card p-8 shadow-[0_4px_24px_rgba(26,26,25,0.06)]">
					<h2 className="m-0 mb-1.5 font-semibold text-[20px] tracking-[-0.01em]">
						Look up your license
					</h2>
					<p className="m-0 mb-5 text-[13.5px] text-ink-muted">
						Enter your license key to see your seats and renewal.
					</p>
					<input
						value={key}
						onChange={(e) => setKey(e.target.value)}
						placeholder="CLEM-XXXX-XXXX-XXXX-XXXX"
						className="w-full rounded-[10px] border border-ink/14 bg-fill-soft px-3.5 py-3 font-mono text-[14px] outline-none focus:border-positive focus:bg-card"
					/>
					{error ? <p className="mt-2 mb-0 text-[12.5px] text-danger">{error}</p> : null}
					<AccentButton className="mt-4 w-full justify-center" onClick={lookup}>
						{loading ? 'Looking up…' : 'Look up my license'}
					</AccentButton>
					<p className="mt-[18px] mb-0 text-center text-[11.5px] text-ink-faint">
						No password. No account. The key is the credential.
					</p>
				</div>
			) : (
				<div className="cbin w-full max-w-[520px]">
					<Card className="mb-4 rounded-2xl p-7">
						<div className="mb-4 flex items-center justify-between">
							<div>
								<div className="font-semibold text-[17px] capitalize">{result.license.product}</div>
								<div className="text-[12.5px] text-ink-muted capitalize">
									{result.license.tier}
									{result.license.expires_at
										? ` · renews ${result.license.expires_at.slice(0, 10)}`
										: ''}
								</div>
							</div>
							<StatusPill status={result.license.status} />
						</div>
						<div className="flex items-center gap-2.5 rounded-[11px] border border-ink/9 bg-fill-soft px-3.5 py-3">
							<span className="flex-1 font-mono font-semibold text-[15px]">
								{result.license.key}
							</span>
							<SecondaryButton
								className="px-2.5 py-1 text-[12px]"
								onClick={() => navigator.clipboard.writeText(result.license.key)}
							>
								Copy
							</SecondaryButton>
						</div>
						{result.download_url ? (
							<a
								href={result.download_url}
								className="mt-4 inline-block rounded-[10px] bg-ink px-4 py-2.5 font-medium text-[13px] text-white no-underline"
							>
								Download
							</a>
						) : null}
					</Card>
					<Card className="overflow-hidden rounded-2xl">
						<div className="border-ink/8 border-b px-5 py-4 font-semibold text-[13.5px]">
							Your devices
						</div>
						{result.activations.length ? (
							result.activations.map((d) => (
								<div
									key={d.instance_id}
									className="flex items-center gap-3 border-ink/5 border-b px-5 py-3.5 last:border-b-0"
								>
									<div className="min-w-0 flex-1">
										<div className="font-medium text-[13.5px]">{d.name}</div>
										<div className="font-mono text-[10.5px] text-ink-faint">{d.instance_id}</div>
									</div>
									<SecondaryButton
										destructive
										className="px-3 py-1.5 text-[12px]"
										onClick={() => deactivate(d.instance_id)}
									>
										Deactivate
									</SecondaryButton>
								</div>
							))
						) : (
							<div className="px-5 py-6 text-center text-[12.5px] text-ink-faint">
								No live activations — every seat is free.
							</div>
						)}
						<div className="px-5 py-3.5 text-[11.5px] text-ink-faint">
							Deactivating frees a seat instantly — no support ticket needed.
						</div>
					</Card>
					<div className="mt-5 text-center">
						<button
							type="button"
							className="cursor-pointer border-none bg-transparent text-[12.5px] text-ink-faint"
							onClick={() => setResult(null)}
						>
							Look up a different license
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
