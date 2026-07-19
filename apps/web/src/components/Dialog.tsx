// ABOUTME: Dialog primitive (docs/DESIGN.md) — centered card over a scrim, form-friendly.
// ABOUTME: Header + body + soft footer band; used by the issue-key and product flows.

import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

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
	useEffect(() => {
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', closeOnEscape);
		return () => window.removeEventListener('keydown', closeOnEscape);
	}, [onClose]);

	const content = (
		<div className="fixed inset-0 z-50 flex items-end justify-center p-2.5 sm:items-center sm:p-6">
			<button
				type="button"
				aria-label="Close dialog"
				className="fixed inset-0 border-none bg-[rgba(26,26,25,0.4)]"
				onClick={onClose}
			/>
			<div
				className="cbin relative max-h-[calc(100dvh-1.25rem)] w-full max-w-[480px] overflow-hidden rounded-2xl bg-card shadow-[0_24px_70px_rgba(0,0,0,0.3)]"
				role="dialog"
				aria-modal="true"
				aria-label={title}
			>
				<div className="px-4 pt-4 sm:px-6 sm:pt-5">
					<h3 className="m-0 font-semibold text-[17px]">{title}</h3>
					{lede ? <p className="m-0 mt-[5px] text-[12.5px] text-ink-faint">{lede}</p> : null}
				</div>
				<div className="flex max-h-[60dvh] flex-col gap-[15px] overflow-y-auto px-4 py-4 sm:max-h-[54vh] sm:px-6 sm:py-5">
					{children}
				</div>
				{footer ? (
					<div className="flex flex-wrap justify-end gap-2.5 border-ink/8 border-t bg-fill-soft px-4 py-3.5 sm:px-6 sm:py-4">
						{footer}
					</div>
				) : null}
			</div>
		</div>
	);

	return typeof document === 'undefined' ? content : createPortal(content, document.body);
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
