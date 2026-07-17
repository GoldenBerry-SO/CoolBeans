// ABOUTME: Products page — one card per product: prefix, seat limits, tiers, and email-from.
// ABOUTME: Empty until products are onboarded via the admin API or beans CLI.

import { Card, EmptyState } from '../components/ui.js';

export function ProductsPage() {
	return (
		<div className="cbin max-w-[1180px]">
			<Card>
				<EmptyState>
					No products yet. Onboarding one is an admin action —{' '}
					<span className="font-mono">beans product create</span> gets you there in a minute.
				</EmptyState>
			</Card>
		</div>
	);
}
