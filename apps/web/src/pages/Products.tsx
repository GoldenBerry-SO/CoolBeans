// ABOUTME: Products page (PRD §16, §29) — product cards with counts, edit, and Stripe connect.
// ABOUTME: Slug and key prefix are immutable after creation; the edit dialog reflects that.

import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, Field, inputClass } from '../components/Dialog.js';
import {
	AccentButton,
	Card,
	EmptyState,
	InkButton,
	PlusIcon,
	SecondaryButton,
} from '../components/ui.js';
import { entitlementsPayload, formatEntitlements, parseEntitlements } from '../lib/entitlements.js';
import {
	type StripePriceRow,
	useArchiveProduct,
	useBilling,
	useConnectStripe,
	useCreateGrant,
	useCreateProduct,
	useGrants,
	useIconVersion,
	useProducts,
	useRemoveProductIcon,
	useRetireGrant,
	useSetProductIcon,
	useStartStripeConnect,
	useStripePrices,
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
	// Cloud shows a pre-flight note before the OAuth redirect: Stripe's authorize page
	// happily creates a brand-new account when it doesn't know which one you meant, and a
	// vendor who lands there unprimed connects the wrong thing (#102).
	const [preConnect, setPreConnect] = useState<Product | null>(null);
	// On cloud a vendor authorizes their own Stripe through Connect, so "Connect Stripe" sends
	// them to Stripe rather than asking for price ids. Self-host has one Stripe key in its own
	// env and nothing to authorize, so it keeps the paste-two-prices dialog.
	const startConnect = useStartStripeConnect();
	// Stripe sends the vendor back here with the outcome in the URL. Say how it went, then
	// clean the query so a refresh does not repeat the message.
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const outcome = params.get('stripe');
		if (!outcome) return;
		if (outcome === 'connected') {
			toast.success('Stripe connected', {
				description:
					'Now map the prices you sell. Create them in your Stripe dashboard first if you haven’t.',
			});
		} else if (outcome === 'cancelled') {
			toast.message('Stripe authorization cancelled');
		} else {
			toast.error('Stripe could not be connected', { description: 'Please start again.' });
		}
		window.history.replaceState({}, '', window.location.pathname);
	}, []);
	const [managing, setManaging] = useState<Product | null>(null);
	const [archiving, setArchiving] = useState<Product | null>(null);

	// Surface the cap where it actually bites, rather than letting the create dialog 409.
	// A raced click still reads fine: the 409 flows through the toast path in queries.ts.
	const billing = useBilling();
	const productUsage = billing.data?.enabled ? billing.data.usage.products : undefined;
	// Billing configured is what makes an instance cloud (same rule the server uses).
	const isCloud = Boolean(billing.data?.enabled);
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
						// Mapping prices and wiring Stripe are two independent things, and making
						// them one either/or button stranded somebody either way round. Keying it
						// off grants meant a cloud vendor who had just authorized was sent back
						// through OAuth forever; keying it off the connection meant a self-hoster,
						// whose connection row is seeded empty, could never reach the dialog that
						// registers the webhook. So offer each when it applies.
						//
						// Mapping needs a connection to hang grants off, which self-host always has.
						const canMapPrices = p.stripeConnected;
						// Whether this product sells anything yet, which is only the label.
						const hasPrices = p.connected;
						// Self-host wires its own webhook through the dialog, and re-running it is
						// how a secret gets rotated, so that stays available. Cloud authorizes once.
						const showConnect = isCloud ? !p.stripeConnected : true;
						return (
							<Card key={p.slug} className="p-4 sm:p-5">
								<div className="mb-4 flex items-center gap-3">
									<ProductMark slug={p.slug} name={p.name} color={productColor(i)} />
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
									{canMapPrices ? (
										<button
											type="button"
											onClick={() => setManaging(p)}
											className={`cursor-pointer rounded-[8px] border px-3 py-[7px] font-medium text-[12.5px] ${hasPrices ? 'border-positive-border bg-positive-tint text-positive-deep' : 'border-ink/14 bg-card text-ink'}`}
										>
											{hasPrices ? 'Selling · prices' : 'Not selling yet — map a price'}
										</button>
									) : null}
									{showConnect ? (
										<button
											type="button"
											disabled={startConnect.isPending}
											onClick={() => (isCloud ? setPreConnect(p) : setConnecting(p))}
											className="cursor-pointer rounded-[8px] border border-stripe bg-stripe px-3 py-[7px] font-semibold text-[12.5px] text-white disabled:opacity-60"
										>
											{startConnect.isPending ? 'Opening Stripe…' : 'Connect Stripe'}
										</button>
									) : null}
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
			{preConnect ? (
				<CloudConnectDialog
					product={preConnect}
					pending={startConnect.isPending}
					onContinue={() => startConnect.mutate()}
					onClose={() => setPreConnect(null)}
				/>
			) : null}
			{connecting ? (
				<ConnectStripeDialog product={connecting} onClose={() => setConnecting(null)} />
			) : null}
			{managing ? <GrantsDialog product={managing} onClose={() => setManaging(null)} /> : null}
			{archiving ? <ArchiveDialog product={archiving} onClose={() => setArchiving(null)} /> : null}
		</div>
	);
}

/**
 * The product's mark: its uploaded icon when one exists, the colored initial when not.
 * The <img> probes /v1/products/:slug/icon directly and falls back on error, so the list
 * API never has to carry an has_icon flag and the browser cache does the heavy lifting.
 */
function ProductMark({ slug, name, color }: { slug: string; name: string; color: string }) {
	// Bumped by the icon mutations. Keying the inner component on it resets the
	// failed-latch and busts the browser cache, so an upload shows on the card
	// immediately instead of after a reload.
	const version = useIconVersion(slug);
	return <ProductMarkImage key={version} slug={slug} name={name} color={color} version={version} />;
}

function ProductMarkImage({
	slug,
	name,
	color,
	version,
}: {
	slug: string;
	name: string;
	color: string;
	version: number;
}) {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return (
			<span
				className="inline-flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] font-semibold text-white"
				style={{ background: color }}
			>
				{name.charAt(0)}
			</span>
		);
	}
	return (
		<img
			src={`/v1/products/${encodeURIComponent(slug)}/icon${version ? `?v=${version}` : ''}`}
			alt=""
			className="h-[38px] w-[38px] flex-none rounded-[10px] object-cover"
			onError={() => setFailed(true)}
		/>
	);
}

/** Read a picked file as base64, refusing what the server would refuse anyway. */
function readIconFile(file: File): Promise<{ mime: string; data_base64: string }> {
	return new Promise((resolve, reject) => {
		if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
			reject(new Error('Use a PNG, JPEG, or WebP image.'));
			return;
		}
		if (file.size > 256 * 1024) {
			reject(new Error('The icon is too large — the cap is 256KB.'));
			return;
		}
		const reader = new FileReader();
		reader.onerror = () => reject(new Error('Could not read that file.'));
		reader.onload = () => {
			const url = String(reader.result);
			resolve({ mime: file.type, data_base64: url.slice(url.indexOf(',') + 1) });
		};
		reader.readAsDataURL(file);
	});
}

function IconField({ product }: { product: Product }) {
	const setIcon = useSetProductIcon();
	const removeIcon = useRemoveProductIcon();
	const [error, setError] = useState<string | null>(null);
	// The mutations bump this shared version, which busts the img cache here AND on the
	// product card — one source of truth for "the icon changed".
	const version = useIconVersion(product.slug);
	const [hasIcon, setHasIcon] = useState(true);
	return (
		<Field
			label="Icon"
			hint="Shown on your licence emails and here in the console. PNG, JPEG, or WebP, up to 256KB. Square looks best."
		>
			<div className="flex items-center gap-3">
				{hasIcon ? (
					<img
						src={`/v1/products/${encodeURIComponent(product.slug)}/icon?v=${version}`}
						alt=""
						className="h-[44px] w-[44px] rounded-[10px] border border-ink/10 object-cover"
						onError={() => setHasIcon(false)}
					/>
				) : (
					<span className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-[10px] bg-fill text-[11px] text-ink-faint">
						none
					</span>
				)}
				<input
					type="file"
					accept="image/png,image/jpeg,image/webp"
					className="text-[12.5px]"
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (!file) return;
						setError(null);
						readIconFile(file)
							.then((payload) =>
								setIcon.mutate(
									{ slug: product.slug, ...payload },
									{ onSuccess: () => setHasIcon(true) },
								),
							)
							.catch((err: Error) => setError(err.message));
					}}
				/>
				{hasIcon ? (
					<SecondaryButton
						className="px-2.5 py-[5px] text-[11.5px]"
						onClick={() => removeIcon.mutate(product.slug, { onSuccess: () => setHasIcon(false) })}
					>
						Remove
					</SecondaryButton>
				) : null}
			</div>
			{error ? <p className="m-0 mt-1.5 text-[12.5px] text-danger">{error}</p> : null}
		</Field>
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
			wide
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
			{/* Uploads go straight to the existing product, so the field only exists when
			    editing — a new product gets its icon right after creation. */}
			{product ? <IconField product={product} /> : null}
			{error ? <p className="m-0 text-[12.5px] text-danger">{error.message}</p> : null}
		</Dialog>
	);
}

/** "€49/year", "€120 one-time" — the way a human recognizes a price. */
function priceAmount(p: StripePriceRow): string {
	const amount =
		p.unit_amount !== null && p.currency
			? new Intl.NumberFormat(undefined, {
					style: 'currency',
					currency: p.currency.toUpperCase(),
					maximumFractionDigits: p.unit_amount % 100 === 0 ? 0 : 2,
				}).format(p.unit_amount / 100)
			: null;
	if (p.recurring) return `${amount ?? 'recurring'}/${p.interval ?? 'period'}`;
	return `${amount ?? ''} one-time`.trim();
}

function priceName(p: StripePriceRow): string {
	return p.nickname ?? p.product_name ?? p.id;
}

function GrantsDialog({ product, onClose }: { product: Product; onClose: () => void }) {
	const grants = useGrants(product.slug);
	const prices = useStripePrices(product.slug);
	const create = useCreateGrant();
	const retire = useRetireGrant();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [manualMode, setManualMode] = useState(false);
	const [manualId, setManualId] = useState('');
	const [plan, setPlan] = useState('');
	const [planTouched, setPlanTouched] = useState(false);
	const [showOptions, setShowOptions] = useState(false);
	// Blank inherits the product's limit, which is what every price did before seats could differ.
	const [seats, setSeats] = useState('');
	// What this price buys, as `pro_reports, seat_limit=5`. Signed into every token it issues,
	// so an app can gate a feature on it — which it must never do with the plan label.
	const [capabilities, setCapabilities] = useState('');
	// Blank means "keep what this price already grants", so clearing has to be said out loud.
	const [clearCapabilities, setClearCapabilities] = useState(false);
	const parsed = parseEntitlements(capabilities);
	const capabilityError = clearCapabilities ? undefined : parsed.error;

	const catalog = prices.data?.prices ?? [];
	const selected = catalog.find((p) => p.id === selectedId) ?? null;
	const priceId = manualMode ? manualId : (selectedId ?? '');
	// Re-mapping is the only time "clear capabilities" means anything.
	const remapping =
		Boolean(selected?.mapped) || grants.data?.some((g) => g.stripePriceId === priceId);
	const canMap = /^price_[A-Za-z0-9]+$/.test(priceId) && !capabilityError && !create.isPending;

	const pick = (p: StripePriceRow) => {
		setManualMode(false);
		setSelectedId(p.id);
		// The plan label defaults to what Stripe already calls it; editing wins after that.
		if (!planTouched) setPlan(p.nickname ?? p.product_name ?? '');
	};

	const seatCount = seats || String(product.activationLimit);
	const preview = selected
		? `Buying ${priceName(selected)} (${priceAmount(selected)}) issues a ${
				selected.recurring
					? 'subscription licence that follows the billing period'
					: 'perpetual licence that never expires'
			}${plan ? `, plan “${plan}”` : ''}, ${seatCount} ${seatCount === '1' ? 'seat' : 'seats'}.`
		: null;

	const submit = () =>
		create.mutate(
			{
				slug: product.slug,
				stripe_price_id: priceId,
				plan: plan || undefined,
				activation_limit: seats ? Number(seats) : undefined,
				entitlements: entitlementsPayload(capabilities, clearCapabilities),
			},
			{
				onSuccess: () => {
					setSelectedId(null);
					setManualId('');
					setPlan('');
					setPlanTouched(false);
					setSeats('');
					setCapabilities('');
					setClearCapabilities(false);
				},
			},
		);

	return (
		<Dialog
			title="What you sell"
			lede={`${product.name} · pick a Stripe price; buyers of it get a licence`}
			onClose={onClose}
			footer={<SecondaryButton onClick={onClose}>Done</SecondaryButton>}
			wide
		>
			{grants.data?.length ? (
				<div className="flex flex-col gap-2">
					<div className="font-semibold text-[12.5px] text-ink-secondary">Selling now</div>
					{grants.data.map((g) => {
						const listed = catalog.find((p) => p.id === g.stripePriceId);
						return (
							<div
								key={g.id}
								className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border border-ink/8 bg-fill-soft px-3 py-2"
							>
								<span className="text-[12.5px]">
									<strong>
										{listed ? `${priceName(listed)} (${priceAmount(listed)})` : g.stripePriceId}
									</strong>
									{' → '}
									{g.kind === 'perpetual' ? 'perpetual licence' : 'subscription licence'}
									{g.plan ? ` · plan “${g.plan}”` : ''}
									{` · ${g.activationLimit ?? product.activationLimit} seats`}
									{g.entitlements ? ` · unlocks ${formatEntitlements(g.entitlements)}` : ''}
								</span>
								{listed ? (
									<span className="font-mono text-[10.5px] text-ink-faint">{g.stripePriceId}</span>
								) : null}
								<div className="flex-1" />
								<button
									type="button"
									onClick={() => retire.mutate({ slug: product.slug, id: g.id })}
									className="cursor-pointer rounded-[7px] border border-ink/12 px-2 py-[4px] text-[11.5px] text-ink-secondary hover:border-danger hover:text-danger"
								>
									Stop selling
								</button>
							</div>
						);
					})}
				</div>
			) : null}

			<Field label={grants.data?.length ? 'Add another price' : 'Pick the price you sell'}>
				{prices.isLoading ? (
					<p className="m-0 text-[12.5px] text-ink-faint">Loading your Stripe prices…</p>
				) : prices.error ? (
					<p className="m-0 text-[12.5px] text-danger">{prices.error.message}</p>
				) : catalog.length ? (
					<div className="flex flex-col gap-1.5">
						{catalog.map((p) => (
							<label
								key={p.id}
								className={`flex cursor-pointer items-center gap-2.5 rounded-[9px] border px-3 py-2.5 ${
									selectedId === p.id && !manualMode
										? 'border-positive bg-positive-tint'
										: 'border-ink/10 hover:border-ink/25'
								}`}
							>
								<input
									type="radio"
									name="price"
									checked={selectedId === p.id && !manualMode}
									onChange={() => pick(p)}
								/>
								<span className="min-w-0 flex-1 text-[13px]">
									<strong>{priceName(p)}</strong>
									<span className="text-ink-muted"> · {priceAmount(p)}</span>
								</span>
								{p.mapped ? (
									<span className="rounded-[6px] bg-fill px-2 py-[2px] text-[10.5px] text-ink-muted">
										mapped to {p.mapped.product}
									</span>
								) : null}
								<span className="font-mono text-[10px] text-ink-faint">{p.id.slice(0, 14)}…</span>
							</label>
						))}
					</div>
				) : (
					<p className="m-0 text-[12.5px] text-ink-muted leading-[1.55]">
						No active prices in
						{prices.data?.connection.account_name
							? ` the connected Stripe account “${prices.data.connection.account_name}”`
							: prices.data?.connection.stripe_account_id
								? ` the connected Stripe account (${prices.data.connection.stripe_account_id})`
								: ' your Stripe account'}
						. Create your product and its price there first — if you administer several Stripe
						accounts, that exact one is where prices must live.
					</p>
				)}
				{manualMode ? (
					<input
						className={`${inputClass} mt-2 font-mono text-[13px]`}
						placeholder="price_1QabcXYZ"
						value={manualId}
						onChange={(e) => setManualId(e.target.value)}
					/>
				) : (
					<button
						type="button"
						onClick={() => {
							setManualMode(true);
							setSelectedId(null);
						}}
						className="mt-2 cursor-pointer border-none bg-transparent p-0 text-left text-[11.5px] text-ink-faint underline hover:text-ink"
					>
						Paste a price id instead
					</button>
				)}
			</Field>

			{selected && !manualMode ? (
				<p className="m-0 rounded-[9px] bg-fill-soft px-3.5 py-2.5 text-[12.5px] leading-[1.55]">
					{preview}
				</p>
			) : null}

			<div>
				<button
					type="button"
					onClick={() => setShowOptions((s) => !s)}
					className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-ink-muted underline hover:text-ink"
				>
					{showOptions ? 'Hide options' : 'Options (plan label, seats, feature unlocks)'}
				</button>
				{showOptions ? (
					<div className="mt-3 flex flex-col gap-3">
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<Field
								label="Plan label"
								hint="Your name for what was bought, shown to you and the buyer. Display only."
							>
								<input
									className={inputClass}
									placeholder="Yearly"
									value={plan}
									onChange={(e) => {
										setPlan(e.target.value);
										setPlanTouched(true);
									}}
								/>
							</Field>
							<Field
								label="Seats"
								hint={`How many devices this price buys. Blank inherits the product's ${product.activationLimit}.`}
							>
								<input
									className={inputClass}
									placeholder={String(product.activationLimit)}
									inputMode="numeric"
									value={seats}
									onChange={(e) => setSeats(e.target.value.replace(/[^0-9]/g, ''))}
								/>
							</Field>
						</div>
						<Field
							label="What it unlocks"
							hint="Names you invent for features that differ between your tiers — your app checks the same names via state.entitlements. Blank keeps what this price already grants."
						>
							<input
								className={inputClass}
								placeholder="pro_reports, seat_limit=5"
								value={capabilities}
								onChange={(e) => setCapabilities(e.target.value)}
							/>
						</Field>
						{remapping ? (
							<label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-secondary">
								<input
									type="checkbox"
									checked={clearCapabilities}
									onChange={(e) => setClearCapabilities(e.target.checked)}
								/>
								Grant no capabilities (clears what this price grants from now on)
							</label>
						) : null}
					</div>
				) : null}
			</div>

			{capabilityError ? <p className="m-0 text-[12.5px] text-danger">{capabilityError}</p> : null}
			<div className="flex justify-end">
				<AccentButton className="w-fit" disabled={!canMap} onClick={submit}>
					{create.isPending ? 'Mapping…' : 'Map price'}
				</AccentButton>
			</div>
			{create.error ? (
				<p className="m-0 text-[12.5px] text-danger">{create.error.message}</p>
			) : null}
		</Dialog>
	);
}

function CloudConnectDialog({
	product,
	pending,
	onContinue,
	onClose,
}: {
	product: Product;
	pending: boolean;
	onContinue: () => void;
	onClose: () => void;
}) {
	return (
		<Dialog
			title="Connect Stripe"
			lede={`${product.name} · authorize the Stripe account you sell with`}
			onClose={onClose}
			footer={
				<>
					<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
					<button
						type="button"
						disabled={pending}
						onClick={onContinue}
						className="cursor-pointer rounded-[9px] border border-stripe bg-stripe px-4 py-[9px] font-semibold text-[13px] text-white disabled:opacity-60"
					>
						{pending ? 'Opening Stripe…' : 'Continue to Stripe'}
					</button>
				</>
			}
		>
			<p className="m-0 text-[12.5px] text-ink-secondary leading-[1.55]">
				You'll be sent to Stripe to authorize access. If you already have a Stripe account, sign in
				there and <strong>pick that account at the top of Stripe's page</strong> — when Stripe
				doesn't know which account you meant, it offers to create a brand-new one instead. If you
				don't have one yet, that form is exactly how you create it.
			</p>
			<p className="m-0 text-[12.5px] text-ink-muted leading-[1.55]">
				Your products and prices live in Stripe, not here. Cool Beans never creates or edits them —
				after connecting, create each price in your Stripe dashboard, then map it to a licence in
				the Stripe prices dialog.
			</p>
		</Dialog>
	);
}

function ConnectStripeDialog({ product, onClose }: { product: Product; onClose: () => void }) {
	// One webhook endpoint per connection: every product shares it and its one signing secret.
	// Registration is connect's whole job now — prices are mapped in the Stripe prices dialog,
	// one at a time. Its predecessor took two price ids and retired every grant not among them.
	const suggestedPath = '/v1/stripe/webhook';
	const [webhookUrl, setWebhookUrl] = useState('');
	const connect = useConnectStripe();

	// Once it succeeds the operator may still have one thing to do in Stripe, so show the
	// result rather than closing over it. A cloud Connect account gets the note instead of the
	// endpoint: its events already arrive on the platform endpoint, and telling that operator to
	// "point Stripe at" a path sends them to their dashboard to wire something that needs no
	// wiring (Bugbot, #88).
	if (connect.isSuccess && connect.data) {
		const alreadyWired = Boolean(connect.data.note);
		return (
			<Dialog
				title="Stripe connected"
				lede={`${product.name} · ${alreadyWired ? 'events already reach us' : 'webhook wired'}`}
				onClose={onClose}
				footer={<SecondaryButton onClick={onClose}>Done</SecondaryButton>}
			>
				{alreadyWired ? null : (
					<Field label="Point Stripe at this endpoint">
						<div className="rounded-[7px] bg-track px-3 py-2 font-mono text-[12.5px]">
							{connect.data.webhook_path}
						</div>
					</Field>
				)}
				<p className="m-0 text-[12.5px] text-ink-muted leading-[1.55]">
					{connect.data.note ??
						(connect.data.secret_rotated
							? 'A fresh signing secret was stored.'
							: 'That endpoint already existed, so your stored signing secret was kept.')}
				</p>
				<p className="m-0 text-[12.5px] text-ink-muted leading-[1.55]">
					Next: map your Stripe prices in the Stripe prices dialog, one grant per price.
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
			lede={`${product.name} · we register the webhook so payment events reach us`}
			onClose={onClose}
			footer={
				<>
					<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
					<button
						type="button"
						disabled={!webhookUrl || connect.isPending}
						onClick={() => connect.mutate({ slug: product.slug, webhook_url: webhookUrl })}
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
			<p className="m-0 text-[12.5px] text-ink-muted leading-[1.55]">
				Prices are not set here: map each Stripe price to what it grants in the Stripe prices
				dialog, and this webhook carries the events for all of them.
			</p>
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
