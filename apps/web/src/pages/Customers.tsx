// ABOUTME: Customers page — buyers grouped by email across every product, with key counts.
// ABOUTME: Derived client-side from the license lists; status is Active/Mixed/Disabled.

import { Card, EmptyState, TableHead } from '../components/ui.js';
import { formatDate } from '../lib/dates.js';
import { useLicensesAcross, useProducts } from '../lib/queries.js';

const GRID = 'min-w-[720px] grid-cols-[1.9fr_1.3fr_0.6fr_0.9fr_0.9fr]';

interface CustomerRow {
	email: string;
	products: Set<string>;
	keys: number;
	anyDisabled: boolean;
	allDisabled: boolean;
	since: string;
}

export function CustomersPage() {
	const products = useProducts();
	const licenses = useLicensesAcross(
		(products.data ?? []).map((p) => p.slug),
		'all',
	);
	const byProduct = new Map((products.data ?? []).map((p) => [p.slug, p.name]));

	const grouped = new Map<string, CustomerRow>();
	for (const l of licenses.data) {
		const email = l.customer_email ?? '(no email)';
		const row = grouped.get(email) ?? {
			email,
			products: new Set<string>(),
			keys: 0,
			anyDisabled: false,
			allDisabled: true,
			since: l.created_at,
		};
		row.products.add(byProduct.get(l.product) ?? l.product);
		row.keys += 1;
		if (l.status === 'disabled') row.anyDisabled = true;
		else row.allDisabled = false;
		if (l.created_at < row.since) row.since = l.created_at;
		grouped.set(email, row);
	}
	const customers = Array.from(grouped.values());

	return (
		<div className="cbin">
			<Card className="overflow-x-auto">
				<TableHead gridClass={GRID} columns={['Customer', 'Products', 'Keys', 'Status', 'Since']} />
				{products.isLoading || licenses.isLoading ? (
					<EmptyState>Loading…</EmptyState>
				) : customers.length ? (
					customers.map((c) => {
						const label = c.allDisabled ? 'Disabled' : c.anyDisabled ? 'Mixed' : 'Active';
						const pillClass =
							label === 'Active'
								? 'border-positive-border bg-positive-tint text-positive-deep'
								: label === 'Mixed'
									? 'border-warn-border bg-warn-tint text-warn'
									: 'border-danger-border bg-danger-tint text-danger';
						return (
							<div
								key={c.email}
								className={`grid items-center gap-3.5 border-ink/5 border-b px-[18px] py-[13px] text-[13px] last:border-b-0 ${GRID}`}
							>
								<div className="flex min-w-0 items-center gap-[11px]">
									<span className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-fill font-semibold text-[12px] text-ink-muted">
										{c.email.charAt(0).toUpperCase()}
									</span>
									<span className="truncate font-mono text-[12px]">{c.email}</span>
								</div>
								<span className="truncate text-ink-secondary">
									{Array.from(c.products).join(', ')}
								</span>
								<span className="font-mono">{c.keys}</span>
								<span
									className={`inline-flex w-fit items-center rounded-full border px-2.5 py-[3px] font-semibold text-[11.5px] ${pillClass}`}
								>
									{label}
								</span>
								<span className="font-mono text-[12px] text-ink-muted">{formatDate(c.since)}</span>
							</div>
						);
					})
				) : (
					<EmptyState>Customers appear with their first purchase.</EmptyState>
				)}
			</Card>
		</div>
	);
}
