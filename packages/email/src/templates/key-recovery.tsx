// ABOUTME: Portal recovery email — every license key we hold for this buyer's address.
// ABOUTME: Sent instead of answering the lookup directly, so an email alone never reveals keys.

import { Body, Container, Head, Heading, Html, Text } from '@react-email/components';
import { BrandHeader } from './header.js';

export interface KeyRecoveryEmailProps {
	keys: { key: string; product: string; status: string }[];
	logoUrl?: string;
}

export function KeyRecoveryEmail({ keys, logoUrl }: KeyRecoveryEmailProps) {
	return (
		<Html lang="en">
			<Head />
			<Body style={{ fontFamily: 'sans-serif' }}>
				<Container>
					<BrandHeader logoUrl={logoUrl} />
					<Heading as="h2">Your Cool Beans license keys</Heading>
					<Text>You asked us to look up the keys for this email address. Here they are.</Text>
					{keys.map((k) => (
						<Text key={k.key}>
							<strong style={{ fontFamily: 'monospace' }}>{k.key}</strong>
							<br />
							{k.product} · {k.status}
						</Text>
					))}
					<Text>If you did not ask for this, you can ignore this email.</Text>
				</Container>
			</Body>
		</Html>
	);
}
