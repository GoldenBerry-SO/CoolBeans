// ABOUTME: Toast host (Sonner) styled to design v2 rather than the library defaults.
// ABOUTME: Mounted once at the app root; call toast() from anywhere.

import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster({ ...props }: ToasterProps) {
	return (
		<Sonner
			className="cbin"
			position="bottom-right"
			toastOptions={{
				classNames: {
					// Our card surface and hairline border, not Sonner's dark default.
					toast:
						'flex items-center gap-2.5 rounded-[10px] border border-ink/12 bg-card px-3.5 py-3 text-[13px] text-ink shadow-[0_12px_34px_rgba(26,26,25,0.16)]',
					description: 'text-[12.5px] text-ink-muted',
					actionButton: 'rounded-[7px] bg-ink px-2.5 py-1 font-medium text-[12px] text-white',
					cancelButton:
						'rounded-[7px] border border-ink/12 px-2.5 py-1 font-medium text-[12px] text-ink-secondary',
					error: 'text-danger',
					success: 'text-ink',
				},
			}}
			{...props}
		/>
	);
}

export { Toaster };
