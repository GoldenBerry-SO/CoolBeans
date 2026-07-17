// ABOUTME: Audit log page — every state change with action, detail, actor, and time.
// ABOUTME: Backed by the audit_log table once the dashboard data wiring lands.

import { Card, EmptyState, TableHead } from '../components/ui.js';

export function AuditPage() {
	return (
		<div className="cbin max-w-[1180px]">
			<Card className="overflow-hidden">
				<TableHead
					gridClass="grid-cols-[190px_1fr_160px_110px]"
					columns={['Action', 'Detail', 'Actor', 'When']}
				/>
				<EmptyState>Every state change lands here, with its actor.</EmptyState>
			</Card>
		</div>
	);
}
