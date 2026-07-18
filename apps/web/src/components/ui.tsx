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

export function InkButton({
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
				'flex cursor-pointer items-center gap-[7px] rounded-[9px] border-none bg-ink px-3.5 py-[9px] font-medium text-[13px] text-white hover:bg-black',
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
	return (
		<span
			className="inline-flex flex-none items-center justify-center rounded-[9px] bg-accent"
			style={{ width: size, height: size }}
		>
			<svg
				width={Math.round(size * 0.61)}
				height={Math.round(size * 0.61)}
				viewBox="0 0 24 24"
				fill="none"
				aria-hidden="true"
			>
				<g transform="rotate(-28 7.8 14.8)">
					<ellipse cx="7.8" cy="14.8" rx="4.8" ry="3.4" fill="#1a1a19" />
					<path
						d="M5.3 15.3C6.4 14.3 9.2 15.3 10.3 14.3"
						stroke="#c8ff4d"
						strokeWidth="1"
						strokeLinecap="round"
						fill="none"
					/>
				</g>
				<g transform="rotate(-28 16.2 9.2)">
					<ellipse cx="16.2" cy="9.2" rx="4.8" ry="3.4" fill="#1a1a19" />
					<path
						d="M13.7 9.7C14.8 8.7 17.6 9.7 18.7 8.7"
						stroke="#c8ff4d"
						strokeWidth="1"
						strokeLinecap="round"
						fill="none"
					/>
				</g>
			</svg>
		</span>
	);
}
