// ABOUTME: The key-delivery email — sent when a license is issued (docs/PRD.md §14).
// ABOUTME: Branded as the vendor's product, not Cool Beans: the buyer bought their app, not ours.

import { Link, Section, Text } from '@react-email/components';
import { EmailShell } from './header.js';
import {
	buttonStyle,
	keyStyle,
	linkStyle,
	mutedTextStyle,
	panelStyle,
	textStyle,
} from './theme.js';

export interface LicenseKeyEmailProps {
	productName: string;
	licenseKey: string;
	downloadUrl?: string;
	renewalDate?: string;
	portalUrl?: string;
	/** `cid:` reference to the attached product icon, or an absolute URL. */
	logoSrc?: string;
}

export function LicenseKeyEmail({
	productName,
	licenseKey,
	downloadUrl,
	renewalDate,
	portalUrl,
	logoSrc,
}: LicenseKeyEmailProps) {
	return (
		<EmailShell
			brandName={productName}
			logoSrc={logoSrc}
			// The key itself is deliberately not in the preview: it would sit in the inbox
			// list, visible to anyone glancing at the screen.
			preview={`Your ${productName} license key is inside.`}
			heading={`Your ${productName} license key`}
			footer={`You are receiving this because you bought ${productName}. Keep this key somewhere safe.`}
		>
			{/* Interpolated as one string on purpose: JSX text next to an expression renders
			    with <!-- --> between them, splitting the product name out of the sentence. */}
			<Text style={textStyle}>{`Here is your key. Enter it in ${productName} to activate.`}</Text>
			<Section style={panelStyle}>
				<Text style={keyStyle}>{licenseKey}</Text>
			</Section>
			{downloadUrl ? (
				<Section style={{ paddingBottom: '18px' }}>
					<Link href={downloadUrl} style={buttonStyle}>
						{`Download ${productName}`}
					</Link>
				</Section>
			) : null}
			{renewalDate ? (
				<Text style={mutedTextStyle}>
					{`Your license renews on ${renewalDate}. Nothing to do until then.`}
				</Text>
			) : null}
			{portalUrl ? (
				<Text style={mutedTextStyle}>
					Need to free up a device or change your billing?{' '}
					<Link href={portalUrl} style={linkStyle}>
						Manage your license
					</Link>
					.
				</Text>
			) : null}
			<Text style={mutedTextStyle}>Cool beans, you're all set.</Text>
		</EmailShell>
	);
}
