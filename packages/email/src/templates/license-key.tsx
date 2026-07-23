// ABOUTME: The key-delivery email — sent when a license is issued (docs/PRD.md §14).
// ABOUTME: Yearly licenses additionally show the renewal date and a customer-portal link.

import { Body, Container, Head, Heading, Html, Link, Section, Text } from '@react-email/components';
import { BrandHeader } from './header.js';

export interface LicenseKeyEmailProps {
	productName: string;
	licenseKey: string;
	downloadUrl?: string;
	renewalDate?: string;
	portalUrl?: string;
	logoUrl?: string;
}

export function LicenseKeyEmail({
	productName,
	licenseKey,
	downloadUrl,
	renewalDate,
	portalUrl,
	logoUrl,
}: LicenseKeyEmailProps) {
	return (
		<Html lang="en">
			<Head />
			<Body style={{ fontFamily: 'sans-serif' }}>
				<Container>
					<BrandHeader logoUrl={logoUrl} />
					<Heading as="h2">Your {productName} license key</Heading>
					<Section>
						<Text style={{ fontFamily: 'monospace', fontSize: '18px' }}>{licenseKey}</Text>
					</Section>
					<Text>Enter this key in {productName} to activate. Cool beans — you're all set.</Text>
					{downloadUrl ? <Link href={downloadUrl}>Download {productName}</Link> : null}
					{renewalDate ? <Text>Your license renews on {renewalDate}.</Text> : null}
					{portalUrl ? <Link href={portalUrl}>Manage your license</Link> : null}
				</Container>
			</Body>
		</Html>
	);
}
