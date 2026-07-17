// ABOUTME: Customers page — buyers across all products with their keys and status.
// ABOUTME: Table shape per docs/DESIGN.md; data arrives with the dashboard wiring.

import { Card, EmptyState, TableHead } from '../components/ui.js';

export function CustomersPage() {
	return (
		<div className="cbin max-w-[1180px]">
			<Card className="overflow-hidden">
				<TableHead
					gridClass="grid-cols-[1.9fr_1.3fr_0.6fr_0.9fr_0.9fr]"
					columns={['Customer', 'Products', 'Keys', 'Status', 'Since']}
				/>
				<EmptyState>Customers appear with their first purchase.</EmptyState>
			</Card>
		</div>
	);
}
