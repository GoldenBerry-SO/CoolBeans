// ABOUTME: Design-system primitives for the console — cards, pills, buttons, empty states.
// ABOUTME: Tokens and rules live in docs/DESIGN.md; keep this file the only source of variants.

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div
			className={clsx(
				'rounded-[13px] border border-ink/10 bg-card shadow-[0_1px_2px_rgba(26,26,25,0.04)]',
				className,
			)}
		>
			{children}
		</div>
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
	className,
}: {
	children: ReactNode;
	onClick?: () => void;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={clsx(
				'flex cursor-pointer items-center gap-[7px] rounded-[9px] border border-accent-border bg-accent px-3.5 py-[9px] font-semibold text-[13px] text-ink shadow-[0_1px_2px_rgba(26,26,25,0.08)] hover:bg-accent-hover',
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
	className,
}: {
	children: ReactNode;
	onClick?: () => void;
	destructive?: boolean;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={clsx(
				'cursor-pointer rounded-[9px] border border-ink/14 bg-card px-3.5 py-[9px] font-medium text-[13px] text-ink',
				destructive ? 'hover:border-danger-cue hover:text-danger' : 'hover:border-ink/30',
				className,
			)}
		>
			{children}
		</button>
	);
}

export function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<div className="font-semibold text-[10px] text-ink-faint uppercase tracking-[0.09em]">
			{children}
		</div>
	);
}

export function TableHead({ columns, gridClass }: { columns: string[]; gridClass: string }) {
	return (
		<div
			className={clsx(
				'grid gap-3.5 border-ink/8 border-b px-[18px] py-[11px] font-semibold text-[10.5px] text-ink-faint uppercase tracking-[0.05em]',
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

export function BeanMark({ size = 31 }: { size?: number }) {
	return (
		<span
			className="inline-flex flex-none items-center justify-center rounded-[9px] bg-accent"
			style={{ width: size, height: size }}
		>
			<svg
				width={size * 0.61}
				height={size * 0.61}
				viewBox="0 0 24 24"
				fill="none"
				aria-hidden="true"
			>
				<ellipse cx="12" cy="12" rx="8.2" ry="6" transform="rotate(-38 12 12)" fill="#1a1a19" />
				<path
					d="M8.8 15.6C10.6 13.4 13.4 10.6 15.2 8.4"
					stroke="#c8ff4d"
					strokeWidth="1.8"
					strokeLinecap="round"
				/>
			</svg>
		</span>
	);
}
