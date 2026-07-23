// ABOUTME: Products page (PRD §16, §29) — product cards with counts, edit, and Stripe connect.
// ABOUTME: Slug and key prefix are immutable after creation; the edit dialog reflects that.

import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Dialog, Field, inputClass } from '../components/Dialog.js';
import {
	AccentButton,
	Card,
	EmptyState,
	InkButton,
	PlusIcon,
	SecondaryButton,
} from '../components/ui.js';
import {
	useArchiveProduct,
	useBilling,
	useConnectStripe,
	useCreateProduct,
	useProducts,
	useUpdateProduct,
} from '../lib/queries.js';
import { productColor } from '../lib/scope.js';
import { SEAT_MODELS, seatModelHint, seatModelLabel } from '../lib/seat-model.js';
import type { Product } from '../lib/types.js';

function MiniStat({ value, label }: { value: number | string; label: string }) {
	return (
		<div className="rounded-[9px] border border-ink/6 bg-fill-soft p-[11px]">
			<div className="font-semibold text-[19px]">{value}</div>
			<div className="text-[10.5px] text-ink-faint">{label}</div>
		</div>
	);
}

function Chip({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
	return (
		<span
			className={`max-w-full truncate rounded-[20px] border border-ink/10 px-[9px] py-1 text-ink-secondary ${mono ? 'font-mono' : ''}`}
		>
			{children}
		</span>
	);
}

export function ProductsPage() {
	const products = useProducts();
	const [showNew, setShowNew] = useState(false);
	const [editing, setEditing] = useState<Product | null>(null);
	const [connecting, setConnecting] = useState<Product | null>(null);
	const [archiving, setArchiving] = useState<Product | null>(null);

	// Surface the cap where it actually bites, rather than letting the create dialog 409.
	// A raced click still reads fine: the 409 flows through the toast path in queries.ts.
	const billing = useBilling();
	const productUsage = billing.data?.enabled ? billing.data.usage.products : undefined;
	// A null limit means no cap, which is Pro and every self-host instance.
	const atCap =
		productUsage !== undefined &&
		productUsage.limit !== null &&
		productUsage.current >= productUsage.limit;

	return (
		<div className="cbin">
			<div className="mb-3.5 flex items-center justify-end gap-3">
				{atCap ? (
					<Link
						to="/billing"
						className="text-[12.5px] text-ink-faint no-underline hover:text-ink hover:underline"
					>
						{productUsage?.current} of {productUsage?.limit} products on Free — Upgrade
					</Link>
				) : null}
				<InkButton onClick={() => setShowNew(true)} disabled={atCap}>
					<PlusIcon />
					New product
				</InkButton>
			</div>
			{products.data?.length ? (
				<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
					{products.data.map((p, i) => {
						const connected = Boolean(p.stripePriceLifetime || p.stripePriceYearly);
						return (
							<Card key={p.slug} className="p-4 sm:p-5">
								<div className="mb-4 flex items-center gap-3">
									<span
										className="inline-flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] font-semibold text-white"
										style={{ background: productColor(i) }}
									>
										{p.name.charAt(0)}
									</span>
									<div className="flex-1">
										<div className="font-semibold text-[15px]">{p.name}</div>
										<div className="font-mono text-[11.5px] text-ink-faint">{p.slug}</div>
									</div>
									<span className="rounded-[6px] border border-ink/8 bg-fill px-2 py-[3px] font-medium font-mono text-[11px]">
										{p.keyPrefix}-••••
									</span>
								</div>
								<div className="mb-4 grid grid-cols-3 gap-2.5">
									<MiniStat value={p.keysTotal} label="keys" />
									<MiniStat value={p.keysActive} label="active" />
									<MiniStat value={p.activationLimit} label="seats/key" />
								</div>
								<div className="flex flex-wrap gap-2 text-[11.5px]">
									<Chip>{seatModelLabel(p.activationModel)}</Chip>
									<Chip>{p.activationLimit} seats/key</Chip>
									<Chip mono>{p.emailFrom}</Chip>
								</div>
								<div className="mt-3.5 flex flex-wrap items-center gap-2 border-ink/6 border-t pt-3.5">
									<SecondaryButton
										className="px-3 py-[7px] text-[12.5px]"
										onClick={() => setEditing(p)}
									>
										Edit
									</SecondaryButton>
									<Link
										to="/products/$slug/integration"
										params={{ slug: p.slug }}
										className="rounded-[9px] border border-ink/14 bg-card px-3 py-[7px] font-medium text-[12.5px] text-ink no-underline hover:border-ink/30"
									>
										Integration
									</Link>
									{connected ? (
										<span className="rounded-[8px] border border-positive-border bg-positive-tint px-3 py-[7px] font-medium text-[12.5px] text-positive-deep">
											Stripe connected
										</span>
									) : (
										<button
											type="button"
											onClick={() => setConnecting(p)}
											className="cursor-pointer rounded-[8px] border border-stripe bg-stripe px-3 py-[7px] font-semibold text-[12.5px] text-white"
										>
											Connect Stripe
										</button>
									)}
									<div className="flex-1" />
									<SecondaryButton
										destructive
										className="px-3 py-[7px] text-[12.5px]"
										onClick={() => setArchiving(p)}
									>
										Archive
									</SecondaryButton>
								</div>
							</Card>
						);
					})}
				</div>
			) : (
				<Card>
					<EmptyState>No products yet. Create one to start issuing keys.</EmptyState>
				</Card>
			)}
			{showNew ? <ProductDialog onClose={() => setShowNew(false)} /> : null}
			{editing ? <ProductDialog product={editing} onClose={() => setEditing(null)} /> : null}
			{connecting ? (
				<ConnectStripeDialog product={connecting} onClose={() => setConnecting(null)} />
			) : null}
			{archiving ? <ArchiveDialog product={archiving} onClose={() => setArchiving(null)} /> : null}
		</div>
	);
}

export function ProductDialog({ product, onClose }: { product?: Product; onClose: () => void }) {
	const [form, setForm] = useState({
		slug: product?.slug ?? '',
		name: product?.name ?? '',
		key_prefix: product?.keyPrefix ?? '',
		email_from: product?.emailFrom ?? '',
		activation_model: product?.activationModel ?? 'node_locked',
		activation_limit: String(product?.activationLimit ?? 3),
	});
	const create = useCreateProduct();
	const update = useUpdateProduct();
	// On the hosted plan we cannot send from a customer's own domain (the sending domain
	// has to be verified), so email_from becomes the reply-to and we send from our address.
	const onCloud = useBilling().data?.enabled ?? false;
	const pending = create.isPending || update.isPending;
	const error = (create.error ?? update.error) as Error | null;
	const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

	function submit() {
		const shared = {
			name: form.name,
			email_from: form.email_from,
			activation_model: form.activation_model,
			activation_limit: Number(form.activation_limit) || 3,
		};
		if (product) {
			update.mutate({ slug: product.slug, ...shared }, { onSuccess: onClose });
		} else {
			create.mutate(
				{ ...shared, slug: form.slug, key_prefix: form.key_prefix },
				{ onSuccess: onClose },
			);
		}
	}

	return (
		<Dialog
			title={product ? 'Edit product' : 'New product'}
			lede="Slug, prefix, seat model and email identity."
			onClose={onClose}
			footer={
				<>
					<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
					<AccentButton onClick={submit}>
						{pending ? 'Saving…' : product ? 'Save product' : 'Create product'}
					</AccentButton>
				</>
			}
		>
			<Field label="Name">
				<input
					value={form.name}
					onChange={(e) => set('name', e.target.value)}
					placeholder="Acme App"
					className={inputClass}
				/>
			</Field>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Field label="Slug">
					<input
						value={form.slug}
						onChange={(e) => set('slug', e.target.value)}
						placeholder="acme-app"
						disabled={Boolean(product)}
						className={`${inputClass} font-mono disabled:text-ink-faint`}
					/>
				</Field>
				<Field label="Key prefix">
					<input
						value={form.key_prefix}
						onChange={(e) => set('key_prefix', e.target.value.toUpperCase())}
						placeholder="ACME"
						disabled={Boolean(product)}
						className={`${inputClass} font-mono disabled:text-ink-faint`}
					/>
				</Field>
			</div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Field label="Seat model" hint={seatModelHint(form.activation_model)}>
					{/* Labels are plain language; the values stay node_locked/floating (the frozen
					    §9 contract), so the API is unchanged. */}
					<select
						value={form.activation_model}
						onChange={(e) => set('activation_model', e.target.value)}
						className={inputClass}
					>
						{SEAT_MODELS.map((m) => (
							<option key={m.value} value={m.value}>
								{m.label}
							</option>
						))}
					</select>
				</Field>
				<Field label="Activation limit">
					<input
						value={form.activation_limit}
						onChange={(e) => set('activation_limit', e.target.value.replace(/\D/g, ''))}
						placeholder="3"
						className={inputClass}
					/>
				</Field>
			</div>
			<Field
				label="Email from"
				hint={
					onCloud
						? 'On the hosted plan we send from our verified address and use this as the reply-to.'
						: undefined
				}
			>
				<input
					value={form.email_from}
					onChange={(e) => set('email_from', e.target.value)}
					placeholder="keys@acme.com"
					className={inputClass}
				/>
			</Field>
			{error ? <p className="m-0 text-[12.5px] text-danger">{error.message}</p> : null}
		</Dialog>
	);
}

function ConnectStripeDialog({ product, onClose }: { product: Product; onClose: () => void }) {
	// The signing secret is stored per product, so only the per-product route can verify
	// those deliveries. Recommending the global path here wired people up to an endpoint
	// that rejected every event.
	const suggestedPath = `/v1/stripe/webhook/${product.slug}`;
	const [webhookUrl, setWebhookUrl] = useState('');
	const [lifetime, setLifetime] = useState('');
	const [yearly, setYearly] = useState('');
	const connect = useConnectStripe();

	// Once it succeeds the operator still has one thing to do in Stripe, so show the
	// result rather than closing over it.
	if (connect.isSuccess && connect.data) {
		return (
			<Dialog
				title="Stripe connected"
				lede={`${product.name} · prices linked, webhook wired`}
				onClose={onClose}
				footer={<SecondaryButton onClick={onClose}>Done</SecondaryButton>}
			>
				<Field label="Point Stripe at this endpoint">
					<div className="rounded-[7px] bg-track px-3 py-2 font-mono text-[12.5px]">
						{connect.data.webhook_path}
					</div>
				</Field>
				<p className="m-0 text-[12.5px] text-ink-muted leading-[1.55]">
					{connect.data.secret_rotated
						? 'A fresh signing secret was stored.'
						: 'That endpoint already existed, so your stored signing secret was kept.'}
				</p>
				<Field label="One setting we cannot make for you">
					<p className="m-0 text-[12.5px] text-ink-muted leading-[1.55]">
						{connect.data.dunning.note}
					</p>
				</Field>
			</Dialog>
		);
	}

	return (
		<Dialog
			title="Connect Stripe"
			lede={`${product.name} · point us at your Stripe prices and we wire the webhook`}
			onClose={onClose}
			footer={
				<>
					<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
					<button
						type="button"
						onClick={() =>
							connect.mutate({
								slug: product.slug,
								webhook_url: webhookUrl,
								lifetime_price_id: lifetime.trim(),
								yearly_price_id: yearly.trim(),
							})
						}
						className="cursor-pointer rounded-[9px] border border-stripe bg-stripe px-4 py-[9px] font-semibold text-[13px] text-white"
					>
						{connect.isPending ? 'Connecting…' : 'Connect Stripe'}
					</button>
				</>
			}
		>
			<Field label="Webhook URL">
				<input
					value={webhookUrl}
					onChange={(e) => setWebhookUrl(e.target.value)}
					placeholder={`https://keys.example.com${suggestedPath}`}
					className={`${inputClass} font-mono text-[13px]`}
				/>
			</Field>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Field
					label="Lifetime price ID"
					hint="From your Stripe dashboard. A checkout for this price issues a lifetime license."
				>
					<input
						value={lifetime}
						onChange={(e) => setLifetime(e.target.value)}
						placeholder="price_123"
						className={`${inputClass} font-mono`}
					/>
				</Field>
				<Field
					label="Yearly price ID"
					hint="The recurring price whose subscription issues a yearly license."
				>
					<input
						value={yearly}
						onChange={(e) => setYearly(e.target.value)}
						placeholder="price_456"
						className={`${inputClass} font-mono`}
					/>
				</Field>
			</div>
			{connect.error ? (
				<p className="m-0 text-[12.5px] text-danger">{(connect.error as Error).message}</p>
			) : null}
		</Dialog>
	);
}

function ArchiveDialog({ product, onClose }: { product: Product; onClose: () => void }) {
	const archive = useArchiveProduct();
	return (
		<Dialog
			title="Archive product?"
			lede="Retire it without breaking anything already sold."
			onClose={onClose}
			footer={
				<>
					<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
					<button
						type="button"
						onClick={() => archive.mutate(product.slug, { onSuccess: onClose })}
						className="cursor-pointer rounded-[9px] border border-danger bg-danger px-4 py-[9px] font-semibold text-[13px] text-white"
					>
						{archive.isPending ? 'Archiving…' : 'Archive product'}
					</button>
				</>
			}
		>
			<p className="m-0 text-[13px] text-ink-muted leading-[1.5]">
				<strong className="text-ink">{product.name}</strong> stops issuing new keys and leaves the
				product list. Its {product.keysTotal} existing{' '}
				{product.keysTotal === 1 ? 'key keeps' : 'keys keep'} validating exactly as before — the
				public contract is frozen, so nothing a customer already bought stops working. You can
				un-archive it later.
			</p>
			<p className="m-0 text-[12.5px] text-warn leading-[1.5]">
				Archiving here does not touch Stripe. Deactivate this product's prices or payment links too,
				otherwise someone can still pay — we'll issue their key rather than take the money for
				nothing, and flag it in the audit log.
			</p>
		</Dialog>
	);
}
