// ABOUTME: Audit log page (PRD §16) — live feed of every state change with actor and time.
// ABOUTME: Backed by GET /admin/audit.

import { Card, EmptyState, TableHead } from '../components/ui.js';
import { formatDetail } from '../lib/audit-format.js';
import { useAudit } from '../lib/queries.js';

export function AuditPage() {
	const audit = useAudit();
	return (
		<div className="cbin">
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
							<span
								className="font-medium font-mono text-[11.5px]"
								style={{
									color: e.action.startsWith('license.disabled')
										? 'var(--color-danger)'
										: e.action.startsWith('license.issued') ||
												e.action.startsWith('license.enabled')
											? 'var(--color-positive-deep)'
											: 'var(--color-ink-secondary)',
								}}
							>
								{e.action}
							</span>
							<span className="truncate text-[12.5px] text-ink-secondary">{formatDetail(e)}</span>
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
