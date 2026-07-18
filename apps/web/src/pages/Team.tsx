// ABOUTME: Team page (PRD §16) — who can sign in to the console, invite, and revoke.
// ABOUTME: Revoking drops their live sessions at once; the last admin cannot be removed.

import { useState } from 'react';
import { Dialog, Field, inputClass } from '../components/Dialog.js';
import {
	AccentButton,
	Card,
	EmptyState,
	PlusIcon,
	SecondaryButton,
	TableHead,
} from '../components/ui.js';
import { getAdminEmail } from '../lib/api.js';
import { useInviteAdmin, useRevokeAdmin, useTeam } from '../lib/queries.js';

const GRID = 'grid-cols-[1.6fr_1.2fr_1fr_auto]';

export function TeamPage() {
	const team = useTeam();
	const revoke = useRevokeAdmin();
	const [inviting, setInviting] = useState(false);
	const me = getAdminEmail();
	const soleAdmin = (team.data?.length ?? 0) <= 1;

	return (
		<div className="cbin">
			<div className="mb-3.5 flex justify-end">
				<AccentButton onClick={() => setInviting(true)}>
					<PlusIcon />
					Invite admin
				</AccentButton>
			</div>
			<Card className="overflow-hidden">
				<TableHead gridClass={GRID} columns={['Admin', 'Added', 'Last signed in', '']} />
				{team.isLoading ? (
					<EmptyState>Loading…</EmptyState>
				) : team.data?.length ? (
					team.data.map((m) => (
						<div
							key={m.id}
							className={`grid items-center gap-3.5 border-ink/5 border-b px-[18px] py-[13px] text-[13px] last:border-b-0 ${GRID}`}
						>
							<div className="flex min-w-0 items-center gap-[11px]">
								<span className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-positive-tint font-semibold text-[12px] text-positive">
									{m.email.charAt(0).toUpperCase()}
								</span>
								<div className="min-w-0">
									<div className="truncate font-mono text-[12px]">{m.email}</div>
									{m.email === me ? (
										<div className="text-[10.5px] text-ink-faint">that's you</div>
									) : null}
								</div>
							</div>
							<span className="font-mono text-[12px] text-ink-muted">
								{m.created_at.slice(0, 10)}
							</span>
							<span className="font-mono text-[12px] text-ink-muted">
								{m.last_login_at ? m.last_login_at.slice(0, 10) : 'never'}
							</span>
							<div className="flex justify-end">
								{/* Removing the only admin would lock the console out entirely. */}
								<SecondaryButton
									destructive
									disabled={soleAdmin}
									title={
										soleAdmin ? 'Invite someone else before removing this account.' : undefined
									}
									className="px-2.5 py-1 text-[11.5px]"
									onClick={() => revoke.mutate(m.id)}
								>
									{soleAdmin ? 'Only admin' : 'Revoke'}
								</SecondaryButton>
							</div>
						</div>
					))
				) : (
					<EmptyState>Nobody here yet.</EmptyState>
				)}
			</Card>
			{inviting ? <InviteDialog onClose={() => setInviting(false)} /> : null}
		</div>
	);
}

function InviteDialog({ onClose }: { onClose: () => void }) {
	const [email, setEmail] = useState('');
	const invite = useInviteAdmin();
	return (
		<Dialog
			title="Invite an admin"
			lede="They sign in with a six-digit code sent to this address. No password to set."
			onClose={onClose}
			footer={
				<>
					<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
					<AccentButton onClick={() => email && invite.mutate(email, { onSuccess: onClose })}>
						{invite.isPending ? 'Inviting…' : 'Invite'}
					</AccentButton>
				</>
			}
		>
			<Field label="Email">
				<input
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="teammate@goldenberry.io"
					className={inputClass}
				/>
			</Field>
			{invite.error ? (
				<p className="m-0 text-[12.5px] text-danger">{(invite.error as Error).message}</p>
			) : null}
		</Dialog>
	);
}
