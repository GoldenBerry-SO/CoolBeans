// ABOUTME: Dropdown menu primitives (Radix) — keyboard nav, focus return and dismissal.
// ABOUTME: Styling stays ours; only the behaviour comes from the primitive.

import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '#lib/utils';

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
	return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
	return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
	className,
	sideOffset = 6,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				data-slot="dropdown-menu-content"
				sideOffset={sideOffset}
				className={cn(
					// Design v2 surface: flat card, hairline border, the same lift the old
					// hand-rolled panel had. Radix only supplies positioning and behaviour.
					'z-50 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-hidden rounded-[11px] border border-ink/12 bg-card p-[5px] shadow-[0_12px_34px_rgba(26,26,25,0.16)]',
					className,
				)}
				{...props}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

function DropdownMenuItem({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
	return (
		<DropdownMenuPrimitive.Item
			data-slot="dropdown-menu-item"
			className={cn(
				'flex w-full cursor-pointer select-none items-center gap-[9px] rounded-[8px] px-[9px] py-2 text-left text-[13px] text-ink outline-none',
				// Radix drives highlight from the keyboard as well as the pointer, so the
				// hover style has to hang off data-highlighted rather than :hover.
				'data-[highlighted]:bg-ink/4',
				className,
			)}
			{...props}
		/>
	);
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger };
