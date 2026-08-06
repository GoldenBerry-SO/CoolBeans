// ABOUTME: The console sign-in email — a six-digit magic code, nothing else to remember.
// ABOUTME: Codes expire quickly; the email says so in one breath, per the design voice.

import { Section, Text } from '@react-email/components';
import { EmailShell } from './header.js';
import { c, MONO, mutedTextStyle, panelStyle, textStyle } from './theme.js';

export interface MagicCodeEmailProps {
	code: string;
	expiresMinutes: number;
	logoSrc?: string;
}

export function MagicCodeEmail({ code, expiresMinutes, logoSrc }: MagicCodeEmailProps) {
	return (
		<EmailShell
			brandName="Cool Beans"
			logoSrc={logoSrc}
			// The code stays out of the preview text on purpose: an inbox list is a
			// shoulder-surfing surface, and this one credential is the whole sign-in.
			preview="Your sign-in code is inside."
			heading="Your sign-in code"
			footer={<>You are receiving this because someone asked to sign in to Cool Beans.</>}
		>
			<Text style={textStyle}>Enter this code in the console to finish signing in.</Text>
			<Section style={panelStyle}>
				<Text
					style={{
						color: c.ink,
						fontFamily: MONO,
						fontSize: '30px',
						fontWeight: 700,
						letterSpacing: '8px',
						lineHeight: '1.3',
						margin: '0',
					}}
				>
					{code}
				</Text>
			</Section>
			{/* One interpolated string, not text-plus-expression: JSX siblings render with
			    <!-- --> markers between them, which bloats the HTML and splits words that
			    tests (and humans reading source) expect to be contiguous. */}
			<Text style={mutedTextStyle}>
				{`It expires in ${expiresMinutes} minutes. If you didn't ask to sign in, you can ignore this email and nothing happens.`}
			</Text>
		</EmailShell>
	);
}
