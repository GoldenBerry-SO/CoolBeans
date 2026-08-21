// ABOUTME: Webhooks page — provider endpoint health cards and the incoming event stream.
// ABOUTME: Configured means we hold the credentials to verify and act on a delivery.

import { clsx } from 'clsx';
import { useState } from 'react';
import { Dialog, Field, inputClass } from '../components/Dialog.js';
import { AccentButton, Card, EmptyState, SecondaryButton, TableHead } from '../components/ui.js';
import { formatDateTime } from '../lib/dates.js';
import {
	useBilling,
	useCreateWebhookEndpoint,
	useDisableWebhookEndpoint,
	useProducts,
	useProviderEvents,
	useProviders,
	useRescueCheckout,
	useRotateWebhookSecret,
	useUnfulfilled,
	useWebhookDeliveries,
	useWebhookEndpoints,
	useWebhookEventTypes,
	type WebhookEndpoint,
} from '../lib/queries.js';

/** "€49.00" from Stripe's minor units; falls back to nothing when Stripe gave no amount. */
function moneyLabel(amount: number | null, currency: string | null): string | null {
	if (amount === null || !currency) return null;
	return new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: currency.toUpperCase(),
	}).format(amount / 100);
}

/**
 * Money taken, nothing shipped (pricing-UX plan phase 3): a paid checkout matched no
 * mapping. The card exists to make this impossible to miss and one click to make right —
 * after mapping the price on the product, Rescue runs the sale through the same
 * idempotent path the webhook would have.
 */
function MissedSalesCard() {
	const unfulfilled = useUnfulfilled();
	const rescueMutation = useRescueCheckout();
	const open = (unfulfilled.data ?? []).filter((u) => !u.fulfilled);
	if (open.length === 0) return null;
	return (
		<Card className="mb-4 overflow-hidden border-danger/40">
			<div className="border-ink/8 border-b px-[18px] py-[15px]">
				<div className="font-semibold text-[13px] text-danger">
					{open.length === 1
						? 'A payment took money but issued no key'
						: `${open.length} payments took money but issued no key`}
				</div>
				<div className="mt-0.5 text-[11.5px] text-ink-muted">
					Each paid for a Stripe price that is not mapped to a product. Map the price (product →
					what you sell), then rescue the sale to issue and email the key.
				</div>
			</div>
			{open.map((u) => (
				<div
					key={u.checkout_id}
					className="flex flex-wrap items-center gap-3 border-ink/5 border-b px-[18px] py-3 last:border-b-0"
				>
					<span className="min-w-0 flex-1 text-[12.5px]">
						<strong>{u.email ?? 'unknown buyer'}</strong>
						{moneyLabel(u.amount_total, u.currency) ? (
							<span className="text-ink-muted">
								{' '}
								· paid {moneyLabel(u.amount_total, u.currency)}
							</span>
						) : null}
						<span className="text-ink-faint"> · {formatDateTime(u.when)}</span>
					</span>
					<span className="font-mono text-[10.5px] text-ink-faint">{u.checkout_id}</span>
					<SecondaryButton
						className="px-3 py-[6px] text-[12px]"
						disabled={rescueMutation.isPending}
						onClick={() => rescueMutation.mutate(u.checkout_id)}
					>
						{rescueMutation.isPending ? 'Rescuing…' : 'Rescue this sale'}
					</SecondaryButton>
				</div>
			))}
		</Card>
	);
}

const GRID = 'min-w-[760px] grid-cols-[0.75fr_1.9fr_1.1fr_0.85fr_0.65fr]';

function ProviderPill({ provider }: { provider: string }) {
	// Platform-billing deliveries (the vendor's own Cool Beans subscription) are a different
	// story from product issuance, so they read differently rather than as another "stripe".
	if (provider.toLowerCase() === 'stripe_billing') {
		return (
			<span className="inline-flex w-fit rounded-[6px] bg-fill px-[9px] py-[2px] font-semibold text-[11px] text-ink-muted">
				Your plan
			</span>
		);
	}
	const stripe = provider.toLowerCase() === 'stripe';
	return (
		<span
			className={clsx(
				'inline-flex w-fit rounded-[6px] px-[9px] py-[2px] font-semibold text-[11px] capitalize',
				stripe ? 'bg-[#efeefb] text-stripe' : 'bg-[#eaf1fb] text-[#1c64c4]',
			)}
		>
			{provider}
		</span>
	);
}

function statusLabel(status: string): { label: string; className: string } {
	if (status === 'done' || status === 'delivered')
		return { label: 'Delivered', className: 'text-positive-deep' };
	if (status === 'failed') return { label: 'Failed', className: 'text-danger' };
	return { label: 'In flight', className: 'text-warn' };
}

/** The secret, shown the one time it exists in plaintext (creation or rotation). */
function SecretDialog({ secret, onClose }: { secret: string; onClose: () => void }) {
	return (
		<Dialog
			title="Signing secret"
			lede="Copy it now — this is the only time it is shown."
			onClose={onClose}
			footer={<SecondaryButton onClick={onClose}>Done</SecondaryButton>}
		>
			<div className="flex items-center gap-2.5 rounded-[9px] bg-track px-3 py-2.5">
				<span className="min-w-0 flex-1 break-all font-mono text-[12.5px]">{secret}</span>
				<SecondaryButton
					className="px-2.5 py-1 text-[12px]"
					onClick={() => navigator.clipboard.writeText(secret)}
				>
					Copy
				</SecondaryButton>
			</div>
			<p className="m-0 text-[12.5px] text-ink-muted leading-[1.55]">
				Verify each delivery: take the <code>t</code> value from the X-CoolBeans-Signature header,
				compute HMAC-SHA256 over <code>t + "." + rawBody</code> with this secret, and compare it to{' '}
				<code>v1</code> in constant time. Reject timestamps older than a few minutes.
			</p>
		</Dialog>
	);
}

function AddEndpointDialog({
	onClose,
	onSecret,
}: {
	onClose: () => void;
	onSecret: (secret: string) => void;
}) {
	const types = useWebhookEventTypes();
	const create = useCreateWebhookEndpoint();
	const [url, setUrl] = useState('');
	const [events, setEvents] = useState<string[]>([]);
	// Empty string means every product in the account, which is what an endpoint created
	// before scoping existed does.
	const [product, setProduct] = useState('');
	const products = useProducts();
	const toggle = (type: string) =>
		setEvents((current) =>
			current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
		);
	return (
		<Dialog
			title="Add a webhook endpoint"
			lede="We POST signed events to your URL as they happen."
			onClose={onClose}
			footer={
				<>
					<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
					<AccentButton
						disabled={!url || events.length === 0 || create.isPending}
						onClick={() =>
							create.mutate(
								{ url, events, ...(product ? { product } : {}) },
								{
									onSuccess: (endpoint) => {
										onClose();
										onSecret(endpoint.secret);
									},
								},
							)
						}
					>
						{create.isPending ? 'Adding…' : 'Add endpoint'}
					</AccentButton>
				</>
			}
		>
			<Field
				label="URL"
				hint="Must be reachable from the internet. Deliveries retry with backoff, and a dead receiver never slows issuance."
			>
				<input
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					placeholder="https://api.your-app.com/coolbeans-hook"
					className={`${inputClass} font-mono text-[13px]`}
				/>
			</Field>
			<Field
				label="Product"
				hint="Scope this endpoint to one product, or leave it on all products to receive events for everything in the account."
			>
				<select value={product} onChange={(e) => setProduct(e.target.value)} className={inputClass}>
					<option value="">All products</option>
					{(products.data ?? []).map((p) => (
						<option key={p.slug} value={p.slug}>
							{p.name}
						</option>
					))}
				</select>
			</Field>
			<Field label="Events to receive">
				<div className="flex flex-col gap-1.5">
					{(types.data ?? []).map((type) => (
						<label
							key={type}
							className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-secondary"
						>
							<input
								type="checkbox"
								checked={events.includes(type)}
								onChange={() => toggle(type)}
							/>
							<span className="font-mono text-[12px]">{type}</span>
						</label>
					))}
				</div>
			</Field>
		</Dialog>
	);
}

function EndpointRow({
	endpoint,
	onSecret,
}: {
	endpoint: WebhookEndpoint;
	onSecret: (secret: string) => void;
}) {
	const [showDeliveries, setShowDeliveries] = useState(false);
	const deliveries = useWebhookDeliveries(showDeliveries ? endpoint.id : null);
	const rotate = useRotateWebhookSecret();
	const disable = useDisableWebhookEndpoint();
	return (
		<div className="border-ink/5 border-b last:border-b-0">
			<div className="flex flex-wrap items-center gap-2.5 px-[18px] py-3">
				<span
					className={clsx(
						'h-[9px] w-[9px] flex-none rounded-full',
						endpoint.status === 'active' ? 'bg-positive' : 'bg-ink/20',
					)}
				/>
				<span className="min-w-0 flex-1 break-all font-mono text-[12.5px]">{endpoint.url}</span>
				<span className="rounded-[6px] bg-fill px-2 py-[2px] text-[10.5px] text-ink-muted">
					{endpoint.product ?? 'all products'}
				</span>
				<span className="font-mono text-[11px] text-ink-faint">{endpoint.events.join(', ')}</span>
				<SecondaryButton
					className="px-2.5 py-[5px] text-[11.5px]"
					onClick={() => setShowDeliveries((s) => !s)}
				>
					{showDeliveries ? 'Hide deliveries' : 'Deliveries'}
				</SecondaryButton>
				{endpoint.status === 'active' ? (
					<>
						<SecondaryButton
							className="px-2.5 py-[5px] text-[11.5px]"
							onClick={() => rotate.mutate(endpoint.id, { onSuccess: onSecret })}
						>
							Rotate secret
						</SecondaryButton>
						<SecondaryButton
							destructive
							className="px-2.5 py-[5px] text-[11.5px]"
							onClick={() => disable.mutate(endpoint.id)}
						>
							Remove
						</SecondaryButton>
					</>
				) : (
					<span className="text-[11.5px] text-ink-faint italic">removed</span>
				)}
			</div>
			{showDeliveries ? (
				<div className="border-ink/5 border-t bg-fill-soft px-[18px] py-2.5">
					{deliveries.data?.length ? (
						deliveries.data.map((d) => {
							const s = statusLabel(d.status);
							return (
								<div key={d.id} className="flex items-center gap-3 py-1.5 text-[12px]">
									<span className="w-[190px] truncate font-mono text-[11.5px]">{d.event_type}</span>
									<span className="font-mono text-[11px] text-ink-faint">
										{formatDateTime(d.created_at)}
									</span>
									<span
										className={clsx('font-semibold text-[11px]', s.className)}
										title={d.last_error ?? undefined}
									>
										{s.label}
										{d.attempts > 0 ? ` ×${d.attempts}` : ''}
									</span>
								</div>
							);
						})
					) : (
						<div className="py-1.5 text-[12px] text-ink-faint">
							{deliveries.isLoading ? 'Loading…' : 'No deliveries yet.'}
						</div>
					)}
				</div>
			) : null}
		</div>
	);
}

export function WebhooksPage() {
	const billing = useBilling();
	const providers = useProviders();
	const events = useProviderEvents();
	const endpoints = useWebhookEndpoints();
	const [adding, setAdding] = useState(false);
	const [secret, setSecret] = useState<string | null>(null);
	// Billing configured is what makes an instance cloud. A Connect vendor's payment events
	// arrive on the platform endpoint automatically, so showing them "stripe · not
	// configured" hands them setup homework that cannot be done (#109). Self-host keeps the
	// cards: there they are real wiring state.
	const isCloud = Boolean(billing.data?.enabled);

	return (
		<div className="cbin">
			{isCloud ? (
				<Card className="mb-4 px-[18px] py-4">
					<div className="font-semibold text-[13px]">Nothing to configure</div>
					<p className="m-0 mt-1 text-[12.5px] text-ink-muted leading-[1.55]">
						Payment events from your connected Stripe arrive here automatically. Every delivery
						below was signature-verified before anything acted on it.
					</p>
				</Card>
			) : (
				<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:gap-4">
					{(providers.data ?? []).map((p) => (
						<Card key={p.name} className="flex-1 px-[18px] py-4">
							<div className="flex items-center gap-[9px]">
								<span
									className={clsx(
										'h-[9px] w-[9px] rounded-full',
										p.configured ? 'bg-positive' : 'bg-ink/20',
									)}
								/>
								<span className="font-semibold text-[13px] capitalize">{p.name}</span>
							</div>
							<div className="mt-1.5 break-all font-mono text-[12px] text-ink-faint">
								{p.path} · {p.configured ? 'verified' : 'not configured'}
							</div>
						</Card>
					))}
				</div>
			)}
			{adding ? <AddEndpointDialog onClose={() => setAdding(false)} onSecret={setSecret} /> : null}
			{secret ? <SecretDialog secret={secret} onClose={() => setSecret(null)} /> : null}

			<MissedSalesCard />

			{/* Outbound (#108): the vendor's own URLs, fed by us. The mirror image of the
			    incoming list below. */}
			<Card className="mb-4 overflow-hidden">
				<div className="flex items-center justify-between border-ink/8 border-b px-[18px] py-[15px]">
					<div>
						<div className="font-semibold text-[13px]">Your endpoints</div>
						<div className="mt-0.5 text-[11.5px] text-ink-faint">
							We POST signed events (licences issued, disabled, activated…) to URLs you add.
						</div>
					</div>
					<SecondaryButton className="px-3 py-[6px] text-[12px]" onClick={() => setAdding(true)}>
						Add endpoint
					</SecondaryButton>
				</div>
				{endpoints.data?.length ? (
					endpoints.data.map((e) => <EndpointRow key={e.id} endpoint={e} onSecret={setSecret} />)
				) : (
					<EmptyState>
						No endpoints yet. Add one to get told the moment a licence is issued.
					</EmptyState>
				)}
			</Card>

			<Card className="overflow-x-auto">
				<div className="border-ink/8 border-b px-[18px] py-[15px]">
					<div className="font-semibold text-[13px]">Incoming payment events</div>
					<div className="mt-0.5 text-[11.5px] text-ink-faint">
						Deliveries we received, with their verification and processing status.
					</div>
				</div>
				<TableHead gridClass={GRID} columns={['Provider', 'Event', 'Event id', 'When', 'Status']} />
				{events.isLoading ? (
					<EmptyState>Loading…</EmptyState>
				) : events.data?.length ? (
					events.data.map((e) => {
						const s = statusLabel(e.status);
						return (
							<div
								key={e.id}
								className={clsx(
									'grid items-center gap-3.5 border-ink/5 border-b px-[18px] py-3 text-[12.5px] last:border-b-0',
									GRID,
								)}
							>
								<ProviderPill provider={e.provider} />
								<span className="truncate font-mono text-[12px]">{e.type}</span>
								<span className="truncate font-mono text-[10px] text-ink-faint">{e.id}</span>
								<span className="font-mono text-[11.5px] text-ink-faint">
									{formatDateTime(e.received_at)}
								</span>
								{/* The error rides the tooltip: one truncated line beats a detail page
							    nobody would build, and the full text is one hover away. */}
								<span
									className={clsx('font-semibold text-[11.5px]', s.className)}
									title={e.last_error ?? undefined}
								>
									{s.label}
									{e.attempts > 0 ? ` ×${e.attempts}` : ''}
								</span>
							</div>
						);
					})
				) : (
					<EmptyState>Signature-verified events stream in here.</EmptyState>
				)}
			</Card>
		</div>
	);
}
