// ABOUTME: Dialog primitive (docs/DESIGN.md) — centered card over a scrim, form-friendly.
// ABOUTME: Header + body + soft footer band; used by the issue-key and product flows.

import type { ReactNode } from 'react';

export function Dialog({
	title,
	lede,
	children,
	footer,
	onClose,
}: {
	title: string;
	lede?: string;
	children: ReactNode;
	footer?: ReactNode;
	onClose: () => void;
}) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-6">
			<button
				type="button"
				aria-label="Close dialog"
				className="fixed inset-0 border-none bg-[rgba(26,26,25,0.4)]"
				onClick={onClose}
			/>
			<div
				className="cbin relative w-full max-w-[480px] overflow-hidden rounded-2xl bg-card shadow-[0_24px_70px_rgba(0,0,0,0.3)]"
				role="dialog"
				aria-modal="true"
				aria-label={title}
			>
				<div className="px-6 pt-5">
					<h3 className="m-0 font-semibold text-[17px]">{title}</h3>
					{lede ? <p className="m-0 mt-[5px] text-[12.5px] text-ink-faint">{lede}</p> : null}
				</div>
				<div className="flex max-h-[54vh] flex-col gap-[15px] overflow-y-auto px-6 py-5">
					{children}
				</div>
				{footer ? (
					<div className="flex justify-end gap-2.5 border-ink/8 border-t bg-fill-soft px-6 py-4">
						{footer}
					</div>
				) : null}
			</div>
		</div>
	);
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div>
			<span className="block font-medium text-[13px] text-ink-body">{label}</span>
			<div className="mt-1.5">{children}</div>
		</div>
	);
}

export const inputClass =
	'w-full rounded-[9px] border border-ink/14 bg-fill-soft px-3 py-2.5 text-[13.5px] outline-none focus:border-positive focus:bg-card';
