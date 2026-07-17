// ABOUTME: Usage page — metered quotas per key with progress bars and limit badges.
// ABOUTME: Meters follow docs/DESIGN.md (warn near the limit, danger over it).

import { Card, CardHeader, EmptyState } from '../components/ui.js';

export function UsagePage() {
	return (
		<div className="cbin max-w-[1180px]">
			<Card className="overflow-hidden">
				<CardHeader
					title={
						<>
							Metered usage{' '}
							<span className="font-normal text-ink-faint">· enforced atomically per key</span>
						</>
					}
				/>
				<EmptyState>No metered products yet. Define a metric and counters land here.</EmptyState>
			</Card>
		</div>
	);
}
