// ABOUTME: The shared shell every Cool Beans email renders inside — brand row, card, footer.
// ABOUTME: The brand name is always text, so an email with images blocked still reads as branded.

import {
	Body,
	Column,
	Container,
	Head,
	Heading,
	Html,
	Img,
	Preview,
	Row,
	Section,
	Text,
} from '@react-email/components';
import type { ReactNode } from 'react';
import { bodyStyle, c, cardStyle, containerStyle, footerStyle, h1Style } from './theme.js';

export interface BrandHeaderProps {
	/** Who this email is from as far as the reader is concerned: a product, or Cool Beans. */
	brandName: string;
	/**
	 * The logo. Either `cid:something` for an inline attachment (renders in clients that
	 * block remote images, which is most of them by default) or an absolute https URL.
	 * Omit and the row degrades to the wordmark alone.
	 */
	logoSrc?: string;
}

const wordmarkStyle = {
	color: c.ink,
	fontSize: '16px',
	fontWeight: 600,
	margin: '0',
} as const;

/**
 * Logo plus wordmark. The name is a real text node rather than the image's alt text on
 * purpose: alt is styled inconsistently and sometimes hidden outright, so relying on it
 * left earlier versions of these emails looking blank when a client blocked images.
 *
 * Two cells of a table rather than inline-block siblings. Outlook renders through Word,
 * which treats `display:inline-block` and `vertical-align` on a <p> as suggestions, so the
 * inline version could drop the wordmark onto its own line. A table row cannot.
 */
export function BrandHeader({ brandName, logoSrc }: BrandHeaderProps) {
	if (!logoSrc) {
		return (
			<Section style={{ paddingBottom: '20px' }}>
				<Text style={wordmarkStyle}>{brandName}</Text>
			</Section>
		);
	}
	return (
		<Section style={{ paddingBottom: '20px' }}>
			<Row>
				<Column style={{ width: '46px', verticalAlign: 'middle' }}>
					<Img
						src={logoSrc}
						width="36"
						height="36"
						alt={brandName}
						style={{ borderRadius: '9px', display: 'block' }}
					/>
				</Column>
				<Column style={{ verticalAlign: 'middle' }}>
					<Text style={wordmarkStyle}>{brandName}</Text>
				</Column>
			</Row>
		</Section>
	);
}

export interface EmailShellProps extends BrandHeaderProps {
	/** The inbox preview line. Without it clients scrape the first body text, which reads badly. */
	preview: string;
	heading: string;
	/** Small print under the card. Transactional context, never marketing. */
	footer: ReactNode;
	children: ReactNode;
}

/** Everything outside the message itself, so the three templates stay consistent. */
export function EmailShell({
	brandName,
	logoSrc,
	preview,
	heading,
	footer,
	children,
}: EmailShellProps) {
	return (
		<Html lang="en">
			<Head>
				{/* Tells a dark-mode client we have explicit colours and it should not invent its own. */}
				<meta name="color-scheme" content="light" />
				<meta name="supported-color-schemes" content="light" />
			</Head>
			<Preview>{preview}</Preview>
			<Body style={bodyStyle}>
				<Container style={containerStyle}>
					<Section style={cardStyle}>
						<BrandHeader brandName={brandName} logoSrc={logoSrc} />
						<Heading as="h1" style={h1Style}>
							{heading}
						</Heading>
						{children}
					</Section>
					<Text style={footerStyle}>{footer}</Text>
				</Container>
			</Body>
		</Html>
	);
}
