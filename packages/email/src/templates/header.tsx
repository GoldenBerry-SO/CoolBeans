// ABOUTME: Shared branded header for every Cool Beans email — just the logo.
// ABOUTME: logoUrl is an absolute PUBLIC_URL/logo.png; renders nothing when it is absent.

import { Img, Section } from '@react-email/components';

/**
 * The logo mark at the top of an email. `logoUrl` must be an absolute, publicly reachable
 * URL, because a mail client fetches it at read time from wherever the recipient is; a
 * relative or bundled path does not exist to them. The API builds it as
 * `${config.publicUrl}/logo.png`, which the console serves as a real image (see
 * console-static.ts). Renders nothing when no URL is given, so a caller that has no public
 * base (or a test) degrades to an unbranded but valid email rather than a broken image.
 */
export function BrandHeader({ logoUrl }: { logoUrl?: string }) {
	if (!logoUrl) return null;
	return (
		<Section style={{ paddingBottom: '16px' }}>
			<Img src={logoUrl} width="44" height="44" alt="Cool Beans" style={{ borderRadius: '10px' }} />
		</Section>
	);
}
