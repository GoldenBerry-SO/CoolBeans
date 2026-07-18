// ABOUTME: Products page (PRD §16, §29) — live product cards and the New product dialog.
// ABOUTME: Cards show prefix, seats, and model; the dialog creates a product via the admin API.

import { useState } from 'react';
import { Dialog, Field, inputClass } from '../components/Dialog.js';
import { AccentButton, Card, EmptyState, SecondaryButton } from '../components/ui.js';
import { useCreateProduct, useProducts } from '../lib/queries.js';

export function ProductsPage() {
	const products = useProducts();
	const [showNew, setShowNew] = useState(false);

	return (
		<div className="cbin max-w-[1180px]">
			<div className="mb-4 flex items-center justify-between">
				<div className="font-mono text-[12.5px] text-ink-faint">
					{products.data?.length ?? 0} products
				</div>
				<AccentButton onClick={() => setShowNew(true)}>New product</AccentButton>
			</div>
			{products.data?.length ? (
				<div className="grid grid-cols-2 gap-4">
					{products.data.map((p) => (
						<Card key={p.slug} className="p-5">
							<div className="mb-4 flex items-center gap-3">
								<span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-fill font-semibold text-[15px] text-ink-muted">
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
							<div className="flex flex-wrap gap-2 text-[11.5px]">
								<span className="rounded-full border border-ink/10 px-2.5 py-1 text-ink-secondary">
									{p.activationModel === 'floating' ? 'Floating' : 'Node-locked'}
								</span>
								<span className="rounded-full border border-ink/10 px-2.5 py-1 text-ink-secondary">
									{p.activationLimit} seats/key
								</span>
								<span className="rounded-full border border-ink/10 px-2.5 py-1 font-mono text-ink-secondary">
									{p.emailFrom}
								</span>
							</div>
						</Card>
					))}
				</div>
			) : (
				<Card>
					<EmptyState>No products yet. Create one to start issuing keys.</EmptyState>
				</Card>
			)}
			{showNew ? <NewProductDialog onClose={() => setShowNew(false)} /> : null}
		</div>
	);
}

function NewProductDialog({ onClose }: { onClose: () => void }) {
	const [form, setForm] = useState({
		slug: '',
		name: '',
		key_prefix: '',
		email_from: '',
		activation_model: 'node_locked',
	});
	const create = useCreateProduct();
	const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

	return (
		<Dialog title="New product" lede="Onboarding a product is an admin action." onClose={onClose}>
			<Field label="Name">
				<input
					value={form.name}
					onChange={(e) => set('name', e.target.value)}
					placeholder="Clementine"
					className={inputClass}
				/>
			</Field>
			<Field label="Slug">
				<input
					value={form.slug}
					onChange={(e) => set('slug', e.target.value)}
					placeholder="clementine"
					className={inputClass}
				/>
			</Field>
			<Field label="Key prefix">
				<input
					value={form.key_prefix}
					onChange={(e) => set('key_prefix', e.target.value.toUpperCase())}
					placeholder="CLEM"
					className={inputClass}
				/>
			</Field>
			<Field label="Email from">
				<input
					value={form.email_from}
					onChange={(e) => set('email_from', e.target.value)}
					placeholder="Clementine <r@clementine.email>"
					className={inputClass}
				/>
			</Field>
			<Field label="Activation model">
				<select
					value={form.activation_model}
					onChange={(e) => set('activation_model', e.target.value)}
					className={inputClass}
				>
					<option value="node_locked">Node-locked</option>
					<option value="floating">Floating</option>
				</select>
			</Field>
			{create.error ? (
				<p className="mb-2 text-[12.5px] text-danger">{(create.error as Error).message}</p>
			) : null}
			<div className="mt-2 flex justify-end gap-2.5">
				<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
				<AccentButton onClick={() => create.mutate(form, { onSuccess: onClose })}>
					{create.isPending ? 'Creating…' : 'Create product'}
				</AccentButton>
			</div>
		</Dialog>
	);
}
