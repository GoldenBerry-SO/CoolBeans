// ABOUTME: Dialog primitive (docs/DESIGN.md) — centered card over a scrim, form-friendly.
// ABOUTME: Used by the issue-key and new-product flows; matches the portal card language.

import type { ReactNode } from 'react';

export function Dialog({
	title,
	lede,
	children,
	onClose,
}: {
	title: string;
	lede?: string;
	children: ReactNode;
	onClose: () => void;
}) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-5">
			<button
				type="button"
				aria-label="Close dialog"
				className="fixed inset-0 border-none bg-[rgba(26,26,25,0.35)]"
				onClick={onClose}
			/>
			<div
				className="cbin relative w-full max-w-[440px] rounded-2xl bg-card p-7 shadow-[0_4px_24px_rgba(26,26,25,0.06)]"
				role="dialog"
				aria-modal="true"
				aria-label={title}
			>
				<h2 className="m-0 mb-1.5 font-semibold text-[20px] tracking-[-0.01em]">{title}</h2>
				{lede ? <p className="m-0 mb-5 text-[13.5px] text-ink-muted">{lede}</p> : null}
				{children}
			</div>
		</div>
	);
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="mb-3">
			<span className="mb-1.5 block font-semibold text-[11px] text-ink-muted uppercase tracking-[0.05em]">
				{label}
			</span>
			{children}
		</div>
	);
}

export const inputClass =
	'w-full rounded-[10px] border border-ink/14 bg-fill-soft px-3.5 py-2.5 text-[14px] outline-none focus:border-positive focus:bg-card';
