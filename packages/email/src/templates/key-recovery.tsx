// ABOUTME: Portal recovery email — every license key we hold for this buyer's address.
// ABOUTME: Sent instead of answering the lookup directly, so an email alone never reveals keys.

import { Section, Text } from '@react-email/components';
import { EmailShell } from './header.js';
import { c, keyStyle, MONO, mutedTextStyle, panelStyle, textStyle } from './theme.js';

export interface KeyRecoveryEmailProps {
	keys: { key: string; product: string; status: string }[];
	logoSrc?: string;
}

export function KeyRecoveryEmail({ keys, logoSrc }: KeyRecoveryEmailProps) {
	return (
		<EmailShell
			brandName="Cool Beans"
			logoSrc={logoSrc}
			preview={
				keys.length === 1 ? 'The license key for this address.' : 'Your license keys are inside.'
			}
			heading={keys.length === 1 ? 'Your license key' : 'Your license keys'}
			footer={
				<>You are receiving this because someone asked us to look up keys for this address.</>
			}
		>
			<Text style={textStyle}>
				{keys.length === 1
					? 'Here is the key we hold for this email address.'
					: `Here are the ${keys.length} keys we hold for this email address.`}
			</Text>
			{keys.map((k) => (
				<Section key={k.key} style={{ ...panelStyle, textAlign: 'left' }}>
					<Text style={{ ...keyStyle, fontSize: '17px', letterSpacing: '0.5px' }}>{k.key}</Text>
					<Text
						style={{
							color: c.muted,
							fontFamily: MONO,
							fontSize: '12.5px',
							margin: '6px 0 0',
						}}
					>
						{k.product} · {k.status}
					</Text>
				</Section>
			))}
			<Text style={mutedTextStyle}>
				A key with a status of <strong>disabled</strong> will not activate. If that looks wrong,
				reply to this email.
			</Text>
			<Text style={mutedTextStyle}>If you didn't ask for this, you can ignore it.</Text>
		</EmailShell>
	);
}
