// ABOUTME: Product Integration view (issue #61) — real config, public keys, endpoints, and
// ABOUTME: pre-filled SDK snippets, all copy-to-clipboard. Nothing secret: the key is the credential.

import { Link, useParams } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { useState } from 'react';
import { Card, CardHeader, EmptyState, SecondaryButton } from '../components/ui.js';
import {
	agentPrompt,
	briefUrl,
	buildSnippets,
	configFacts,
	guideUrl,
	publicEndpoints,
	type SnippetTarget,
} from '../lib/integration.js';
import { useProductPubkeys, useProducts } from '../lib/queries.js';

/** A small copy-to-clipboard button that flips to "Copied" for a moment. */
function CopyButton({ text, className }: { text: string; className?: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<SecondaryButton
			className={clsx('px-2.5 py-[5px] text-[11.5px]', className)}
			onClick={() => {
				void navigator.clipboard.writeText(text);
				setCopied(true);
				setTimeout(() => setCopied(false), 1200);
			}}
		>
			{copied ? 'Copied' : 'Copy'}
		</SecondaryButton>
	);
}

/** A labelled copyable value row. */
function CopyRow({
	label,
	value,
	hint,
	mono,
}: {
	label: string;
	value: string;
	hint?: string;
	mono?: boolean;
}) {
	return (
		<div className="flex items-start gap-3 border-ink/5 border-b px-[18px] py-[13px] last:border-b-0">
			<div className="min-w-0 flex-1">
				<div className="font-medium text-[12px] text-ink-muted">{label}</div>
				<div className={clsx('mt-1 break-words text-[13.5px]', mono && 'font-mono text-[12.5px]')}>
					{value}
				</div>
				{hint ? <div className="mt-1 text-[11.5px] text-ink-faint">{hint}</div> : null}
			</div>
			<CopyButton text={value} />
		</div>
	);
}

export function IntegrationPage() {
	const { slug } = useParams({ strict: false }) as { slug: string };
	const products = useProducts();
	const pubkeys = useProductPubkeys(slug ?? '');
	const [target, setTarget] = useState<SnippetTarget>('node');

	if (products.isLoading) return <EmptyState>Loading…</EmptyState>;
	const product = products.data?.find((p) => p.slug === slug);
	if (!product) return <EmptyState>No product with that slug.</EmptyState>;

	// The console is served same-origin as the API on both cloud and self-host, so where
	// the operator reached this page is exactly the base URL their app should call.
	const baseUrl = window.location.origin;
	const keys = pubkeys.data ?? {};
	const snippets = buildSnippets(product, baseUrl, keys);
	const active = snippets.find((s) => s.target === target) ?? snippets[0];
	const facts = configFacts(product, baseUrl);
	const endpoints = publicEndpoints(product);
	const keyEntries = Object.entries(keys);

	return (
		<div className="cbin max-w-[1020px]">
			<Link
				to="/products"
				className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted hover:text-ink"
			>
				← All products
			</Link>

			<div className="mb-[22px]">
				<h1 className="m-0 font-semibold text-[22px] tracking-[-0.01em]">{product.name}</h1>
				<p className="mt-[7px] mb-0 text-[13px] text-ink-muted">
					Everything to wire {product.name} into your app. All public, all copy-paste. The license
					key is the only credential, so there is nothing secret to hide here.
				</p>
			</div>

			<Card className="mb-4 px-[18px] py-4">
				<div className="mb-2 flex flex-wrap items-center gap-2">
					<span className="font-semibold text-[13px]">Hand this to your coding agent</span>
					<a
						href={briefUrl(baseUrl, product.slug)}
						target="_blank"
						rel="noreferrer"
						className="text-[11.5px] text-ink-muted underline hover:text-ink"
					>
						brief ↗
					</a>
					<a
						href={guideUrl(baseUrl)}
						target="_blank"
						rel="noreferrer"
						className="text-[11.5px] text-ink-muted underline hover:text-ink"
					>
						guide ↗
					</a>
				</div>
				<p className="mt-0 mb-3 text-[12.5px] text-ink-muted leading-[1.55]">
					Paste this into Claude Code, Cursor, or any coding agent. It fetches the hosted brief and
					SDK guide and wires {product.name} in for you.
				</p>
				<div className="relative">
					<CopyButton
						text={agentPrompt(product, baseUrl)}
						className="absolute top-2.5 right-2.5 z-10"
					/>
					{/* Prose wraps, unlike the code snippets below: an agent prompt read sideways
					    through a horizontal scrollbar is a prompt nobody reviews (#95). The copy
					    button carries the raw text, so wrapping is display-only. */}
					<pre className="m-0 whitespace-pre-wrap break-words rounded-[9px] bg-track p-4 font-mono text-[12.5px] text-ink-body leading-[1.6]">
						<code>{agentPrompt(product, baseUrl)}</code>
					</pre>
				</div>
			</Card>

			<div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_1fr]">
				<Card className="overflow-hidden">
					<CardHeader title="Config" />
					{facts.map((f) => (
						<CopyRow key={f.label} label={f.label} value={f.value} hint={f.hint} mono={f.mono} />
					))}
				</Card>

				<Card className="overflow-hidden">
					<CardHeader
						title="Public keys"
						action={<span className="font-mono text-[12px] text-ink-muted">ed25519</span>}
					/>
					{keyEntries.length ? (
						keyEntries.map(([kid, key]) => (
							<CopyRow key={kid} label={`kid ${kid}`} value={key} mono />
						))
					) : (
						<EmptyState>
							No signing keys yet — the SDK fetches them by licence key on the first open(). They
							appear here once a licence has been validated.
						</EmptyState>
					)}
				</Card>
			</div>

			<Card className="mt-4 overflow-hidden">
				<CardHeader
					title="Install and code"
					action={
						<div className="flex flex-wrap gap-1.5">
							{snippets.map((s) => (
								<button
									key={s.target}
									type="button"
									onClick={() => setTarget(s.target)}
									className={clsx(
										'cursor-pointer rounded-[7px] px-2.5 py-[5px] font-medium text-[12px]',
										s.target === active.target
											? 'bg-ink text-white'
											: 'bg-track text-ink-muted hover:text-ink',
									)}
								>
									{s.label}
								</button>
							))}
						</div>
					}
				/>
				<div className="px-[18px] py-4">
					{active.install ? (
						<div className="mb-3 flex items-center gap-3">
							<code className="min-w-0 flex-1 truncate rounded-[7px] bg-track px-3 py-2 font-mono text-[12.5px]">
								{active.install}
							</code>
							<CopyButton text={active.install} />
						</div>
					) : null}
					<div className="relative">
						<CopyButton text={active.code} className="absolute top-2.5 right-2.5 z-10" />
						<pre className="m-0 overflow-x-auto rounded-[9px] bg-track p-4 font-mono text-[12.5px] text-ink-body leading-[1.6]">
							<code>{active.code}</code>
						</pre>
					</div>
				</div>
			</Card>

			<Card className="mt-4 overflow-hidden">
				<CardHeader title="Public endpoints your app calls" />
				{endpoints.map((e) => (
					<div
						key={e.path}
						className="flex items-start gap-3 border-ink/5 border-b px-[18px] py-3 last:border-b-0"
					>
						<span className="w-[46px] flex-none font-mono text-[11px] text-ink-muted">
							{e.method}
						</span>
						<div className="min-w-0 flex-1">
							<div className="break-all font-mono text-[12.5px]">{e.path}</div>
							<div className="mt-0.5 text-[11.5px] text-ink-faint">{e.what}</div>
						</div>
					</div>
				))}
			</Card>
		</div>
	);
}
