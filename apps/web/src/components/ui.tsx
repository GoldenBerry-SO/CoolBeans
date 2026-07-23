// ABOUTME: Design-system primitives for the console — cards, pills, buttons, empty states.
// ABOUTME: Tokens and rules live in docs/DESIGN.md; keep this file the only source of variants.

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div className={clsx('rounded-[10px] border border-ink/10 bg-card', className)}>{children}</div>
	);
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
	return (
		<div className="flex items-center justify-between border-ink/8 border-b px-5 py-[15px]">
			<div className="font-semibold text-[13px]">{title}</div>
			{action}
		</div>
	);
}

export function StatusPill({ status }: { status: 'active' | 'disabled' }) {
	return (
		<span
			className={clsx(
				'inline-flex w-fit items-center rounded-full border px-2.5 py-[3px] font-semibold text-[11.5px]',
				status === 'active'
					? 'border-positive-border bg-positive-tint text-positive-deep'
					: 'border-danger-border bg-danger-tint text-danger',
			)}
		>
			{status === 'active' ? 'Active' : 'Disabled'}
		</span>
	);
}

export function TierText({ tier }: { tier: 'lifetime' | 'yearly' | 'trial' }) {
	const label = { lifetime: 'Lifetime', yearly: 'Yearly', trial: 'Trial' }[tier];
	return (
		<span
			className={clsx(
				'font-medium text-[12.5px]',
				tier === 'lifetime' && 'text-tier-lifetime',
				tier === 'yearly' && 'text-ink-secondary',
				tier === 'trial' && 'text-warn',
			)}
		>
			{label}
		</span>
	);
}

export function AccentButton({
	children,
	onClick,
	disabled,
	className,
}: {
	children: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={clsx(
				'flex items-center gap-[7px] rounded-[9px] border border-accent-border bg-accent px-3.5 py-[9px] font-semibold text-[13px] text-ink shadow-[0_1px_2px_rgba(26,26,25,0.08)]',
				disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-accent-hover',
				className,
			)}
		>
			{children}
		</button>
	);
}

export function InkButton({
	children,
	onClick,
	disabled,
	className,
}: {
	children: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={clsx(
				'flex items-center gap-[7px] rounded-[9px] border-none bg-ink px-3.5 py-[9px] font-medium text-[13px] text-white',
				disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-black',
				className,
			)}
		>
			{children}
		</button>
	);
}

export function SecondaryButton({
	children,
	onClick,
	destructive,
	disabled,
	title,
	className,
}: {
	children: ReactNode;
	onClick?: () => void;
	destructive?: boolean;
	disabled?: boolean;
	title?: string;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={clsx(
				'rounded-[9px] border border-ink/14 bg-card px-3.5 py-[9px] font-medium text-[13px] text-ink',
				disabled
					? 'cursor-not-allowed text-ink-faint'
					: clsx(
							'cursor-pointer',
							destructive ? 'hover:border-danger-cue hover:text-danger' : 'hover:border-ink/30',
						),
				className,
			)}
		>
			{children}
		</button>
	);
}

/**
 * A usage bar against a limit. `null` means no cap, which is how both the metered-usage
 * API and the plan API say "unlimited" — Pro and self-host both land here.
 * Thresholds follow docs/DESIGN.md: warn above 85%, danger at or over the limit.
 */
export function Meter({ current, limit }: { current: number; limit: number | null }) {
	if (limit === null) return <div className="text-[12px] text-ink-faint">no cap</div>;
	const pct = Math.min(100, Math.round((current / limit) * 100));
	const over = current >= limit;
	return (
		<div className="h-2 overflow-hidden rounded-[5px] bg-track">
			<div
				className={clsx(
					'h-full rounded-[5px]',
					over ? 'bg-danger-cue' : pct > 85 ? 'bg-meter-near' : 'bg-meter-ok',
				)}
				style={{ width: `${pct}%` }}
			/>
		</div>
	);
}

/**
 * The OK / percentage / at-limit chip that sits beside a Meter.
 *
 * "At limit" and "Over limit" are deliberately different words. Somebody on Free using
 * their one allowed product is exactly within their plan, and telling them they are "over
 * limit" reads as a violation they have not committed. Only genuinely exceeding the cap —
 * which happens when a webhook issues past it, or after a downgrade — says over.
 */
export function LimitBadge({ current, limit }: { current: number; limit: number | null }) {
	if (limit === null) return null;
	const pct = Math.min(100, Math.round((current / limit) * 100));
	const full = current >= limit;
	return (
		<span
			className={clsx(
				'inline-flex rounded-full px-[9px] py-[3px] font-semibold text-[11px]',
				full
					? 'bg-danger-tint text-danger'
					: pct > 85
						? 'bg-warn-tint text-warn'
						: 'bg-positive-tint text-positive-deep',
			)}
		>
			{current > limit ? 'Over limit' : full ? 'At limit' : pct > 85 ? `${pct}%` : 'OK'}
		</span>
	);
}

export function SectionLabel({ children }: { children: ReactNode }) {
	return <div className="font-medium text-[12.5px] text-ink-label">{children}</div>;
}

export function TableHead({ columns, gridClass }: { columns: string[]; gridClass: string }) {
	return (
		<div
			className={clsx(
				'grid gap-3.5 border-ink/8 border-b px-[18px] py-[11px] font-medium text-[12px] text-ink-muted',
				gridClass,
			)}
		>
			{columns.map((c) => (
				<span key={c}>{c}</span>
			))}
		</div>
	);
}

export function EmptyState({ children }: { children: ReactNode }) {
	return <div className="p-11 text-center text-[13px] text-ink-faint">{children}</div>;
}

export function PlusIcon() {
	return (
		<svg
			width="15"
			height="15"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.2"
			strokeLinecap="round"
			aria-hidden="true"
		>
			<path d="M12 5v14M5 12h14" />
		</svg>
	);
}

export function BeanMark({ size = 31 }: { size?: number }) {
	// The brand mark, from apps/web/public/logo.png. The art carries its own lime tile and
	// rounded (transparent) corners, so it needs no wrapper or background. alt="" because a
	// "Cool Beans" wordmark always sits right beside it — the image is decorative to a
	// screen reader, not a second announcement of the name.
	return (
		<img
			src="/logo.png"
			alt=""
			width={size}
			height={size}
			className="flex-none"
			style={{ width: size, height: size }}
		/>
	);
}
