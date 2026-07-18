// ABOUTME: Audit log page (PRD §16) — live feed of every state change with actor and time.
// ABOUTME: Backed by GET /admin/audit.

import { Card, EmptyState, TableHead } from '../components/ui.js';
import { useAudit } from '../lib/queries.js';

export function AuditPage() {
	const audit = useAudit();
	return (
		<div className="cbin max-w-[1180px]">
			<Card className="overflow-hidden">
				<TableHead
					gridClass="grid-cols-[190px_1fr_160px_150px]"
					columns={['Action', 'Detail', 'Actor', 'When']}
				/>
				{audit.data?.length ? (
					audit.data.map((e) => (
						<div
							key={e.id}
							className="grid grid-cols-[190px_1fr_160px_150px] items-center gap-3.5 border-ink/5 border-b px-5 py-3 last:border-b-0"
						>
							<span className="font-medium text-[12.5px]">{e.action}</span>
							<span className="truncate text-[12.5px] text-ink-secondary">
								{e.detail ? JSON.stringify(e.detail) : '—'}
							</span>
							<span className="truncate font-mono text-[11px] text-ink-muted">{e.actor}</span>
							<span className="font-mono text-[11px] text-ink-faint">{e.created_at}</span>
						</div>
					))
				) : (
					<EmptyState>Every state change lands here, with its actor.</EmptyState>
				)}
			</Card>
		</div>
	);
}
