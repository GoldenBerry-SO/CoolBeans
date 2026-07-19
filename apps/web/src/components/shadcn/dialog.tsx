// ABOUTME: Dialog primitives (Radix) — focus trap, focus return, scroll lock, dismissal.
// ABOUTME: Unstyled here on purpose; the console's dialog look lives in components/Dialog.tsx.

import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '#lib/utils';

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogOverlay({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
	return (
		<DialogPrimitive.Overlay
			data-slot="dialog-overlay"
			className={cn('fixed inset-0 z-50 bg-[rgba(26,26,25,0.4)]', className)}
			{...props}
		/>
	);
}

function DialogContent({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
	return (
		<DialogPrimitive.Content data-slot="dialog-content" className={cn(className)} {...props} />
	);
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
	return <DialogPrimitive.Title data-slot="dialog-title" className={cn(className)} {...props} />;
}

function DialogDescription({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn(className)}
			{...props}
		/>
	);
}

export { Dialog, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogTitle };
