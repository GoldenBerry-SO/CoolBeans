// ABOUTME: The console sign-in email — a six-digit magic code, nothing else to remember.
// ABOUTME: Codes expire quickly; the email says so in one breath, per the design voice.

import { Body, Container, Head, Heading, Html, Text } from '@react-email/components';

export interface MagicCodeEmailProps {
	code: string;
	expiresMinutes: number;
}

export function MagicCodeEmail({ code, expiresMinutes }: MagicCodeEmailProps) {
	return (
		<Html lang="en">
			<Head />
			<Body style={{ fontFamily: 'sans-serif' }}>
				<Container>
					<Heading as="h2">Your Cool Beans sign-in code</Heading>
					<Text
						style={{
							fontFamily: 'monospace',
							fontSize: '28px',
							letterSpacing: '6px',
							fontWeight: 600,
						}}
					>
						{code}
					</Text>
					<Text>
						Enter this code in the console to sign in. It expires in {expiresMinutes} minutes. If
						you didn't request it, you can ignore this email.
					</Text>
				</Container>
			</Body>
		</Html>
	);
}
