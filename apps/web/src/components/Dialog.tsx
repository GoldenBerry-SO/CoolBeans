// ABOUTME: Dialog primitive (docs/DESIGN.md) — centered card over a scrim, form-friendly.
// ABOUTME: Header + body + soft footer band; used by the issue-key and product flows.

import { type ReactNode, useEffect, useRef } from 'react';
import {
	DialogContent,
	DialogDescription,
	DialogOverlay,
	DialogPortal,
	Dialog as DialogRoot,
	DialogTitle,
} from './shadcn/dialog.js';

/**
 * Every caller mounts this conditionally rather than passing `open`, so the root is
 * always open while mounted and unmounting is what closes it. Radix supplies the focus
 * trap, focus return to whatever opened it, scroll lock and dismissal; the look below is
 * unchanged from the hand-rolled version.
 */
export function Dialog({
	title,
	lede,
	children,
	footer,
	onClose,
	wide,
}: {
	title: string;
	lede?: string;
	children: ReactNode;
	footer?: ReactNode;
	onClose: () => void;
	/**
	 * Opt-in 70%-of-screen variant for dialogs that are really small forms with several
	 * fields (the grants dialog, #105). The 480px default suits confirmations and one-field
	 * flows; a pricing form in 480px scrolls and nothing can be scanned.
	 */
	wide?: boolean;
}) {
	// Radix restores focus when its content unmounts, but our callers close a dialog by
	// unmounting the whole root in the same commit, so that cleanup never gets to run and
	// focus lands on <body>. Closing then dumps a keyboard user at the top of the page.
	// Remember what opened it and put focus back ourselves.
	const opener = useRef<HTMLElement | null>(null);
	useEffect(() => {
		opener.current = document.activeElement as HTMLElement | null;
		return () => {
			const target = opener.current;
			if (target?.isConnected) target.focus();
		};
	}, []);

	return (
		<DialogRoot
			open
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogPortal>
				{/* The card sits inside the overlay so the scrim is genuinely outside the
				    content. With the overlay as a sibling and the content stretched over the
				    viewport, every backdrop click lands inside the content and Radix never
				    dismisses — which is how the old click-the-scrim-to-close behaviour got
				    lost. */}
				<DialogOverlay className="flex items-end justify-center p-2.5 sm:items-center sm:p-6">
					<DialogContent
						className={`cbin relative max-h-[calc(100dvh-1.25rem)] w-full overflow-hidden rounded-2xl bg-card shadow-[0_24px_70px_rgba(0,0,0,0.3)] ${wide ? 'max-w-[480px] sm:max-w-[max(480px,70vw)]' : 'max-w-[480px]'}`}
					>
						<div className="px-4 pt-4 sm:px-6 sm:pt-5">
							<DialogTitle className="m-0 font-semibold text-[17px]">{title}</DialogTitle>
							{lede ? (
								<DialogDescription className="m-0 mt-[5px] text-[12.5px] text-ink-faint">
									{lede}
								</DialogDescription>
							) : (
								// Radix warns when a dialog has no description. Ours are labelled by
								// their title, so state that rather than inventing copy.
								<DialogDescription className="sr-only">{title}</DialogDescription>
							)}
						</div>
						<div
							className={`flex max-h-[60dvh] flex-col gap-[15px] overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 ${wide ? 'sm:max-h-[70vh]' : 'sm:max-h-[54vh]'}`}
						>
							{children}
						</div>
						{footer ? (
							<div className="flex flex-wrap justify-end gap-2.5 border-ink/8 border-t bg-fill-soft px-4 py-3.5 sm:px-6 sm:py-4">
								{footer}
							</div>
						) : null}
					</DialogContent>
				</DialogOverlay>
			</DialogPortal>
		</DialogRoot>
	);
}

export function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<div>
			<span className="block font-medium text-[13px] text-ink-body">{label}</span>
			<div className="mt-1.5">{children}</div>
			{hint ? <p className="mt-1.5 m-0 text-[12px] text-ink-faint">{hint}</p> : null}
		</div>
	);
}

export const inputClass =
	'w-full rounded-[9px] border border-ink/14 bg-fill-soft px-3 py-2.5 text-[13.5px] outline-none focus:border-positive focus:bg-card';
