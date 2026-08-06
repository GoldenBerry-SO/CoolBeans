// ABOUTME: Shared design tokens for every Cool Beans email, matching docs/DESIGN.md.
// ABOUTME: Inline styles only: a <style> block is stripped or ignored by most mail clients.

/**
 * Hex literals, not CSS variables or classes. Mail clients strip <style> blocks (Gmail
 * keeps some, Outlook keeps almost none), so every value has to arrive inline on the
 * element. Colours mirror the landing site so an email and coolbeans.tools look related.
 */
export const c = {
	/** Page behind the card. */
	paper: '#f7f5ef',
	card: '#ffffff',
	border: '#e6e3d8',
	ink: '#1a1a19',
	body: '#3a3a36',
	muted: '#6e6e68',
	faint: '#9a978c',
	/** The one accent, used for the key panel and buttons. */
	lime: '#c8ff4d',
	limeDeep: '#86b32d',
	moss: '#3f6b12',
	/** Tint behind a key or code, so it reads as a thing to copy. */
	panel: '#f4f6ec',
	panelBorder: '#d8e3b8',
} as const;

/**
 * A system stack. Webfonts need @font-face in a <style> block, which is exactly what
 * clients drop, so a custom face would silently fall back on most of them anyway.
 */
export const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

/** Mono for keys and codes: the whole point is copying them without transcription errors. */
export const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';

export const bodyStyle = {
	backgroundColor: c.paper,
	fontFamily: FONT,
	margin: '0',
	padding: '24px 12px',
} as const;

export const containerStyle = {
	maxWidth: '520px',
	margin: '0 auto',
} as const;

export const cardStyle = {
	backgroundColor: c.card,
	border: `1px solid ${c.border}`,
	borderRadius: '14px',
	padding: '32px',
} as const;

export const h1Style = {
	color: c.ink,
	fontSize: '22px',
	fontWeight: 600,
	lineHeight: '1.3',
	margin: '0 0 8px',
} as const;

export const textStyle = {
	color: c.body,
	fontSize: '15px',
	lineHeight: '1.55',
	margin: '0 0 16px',
} as const;

export const mutedTextStyle = {
	color: c.muted,
	fontSize: '13.5px',
	lineHeight: '1.55',
	margin: '0 0 12px',
} as const;

/** The panel a licence key or sign-in code sits in. */
export const panelStyle = {
	backgroundColor: c.panel,
	border: `1px solid ${c.panelBorder}`,
	borderRadius: '10px',
	padding: '18px 16px',
	margin: '0 0 20px',
	textAlign: 'center' as const,
};

export const keyStyle = {
	color: c.ink,
	fontFamily: MONO,
	fontSize: '20px',
	fontWeight: 700,
	letterSpacing: '1px',
	lineHeight: '1.4',
	margin: '0',
	// Long keys must not push the card wide on a narrow phone.
	wordBreak: 'break-all' as const,
};

export const buttonStyle = {
	backgroundColor: c.lime,
	border: `1px solid ${c.limeDeep}`,
	borderRadius: '9px',
	color: c.ink,
	display: 'inline-block',
	fontSize: '15px',
	fontWeight: 600,
	padding: '11px 20px',
	textDecoration: 'none',
} as const;

export const footerStyle = {
	color: c.faint,
	fontSize: '12px',
	lineHeight: '1.5',
	margin: '18px 4px 0',
	textAlign: 'center' as const,
};

export const linkStyle = { color: c.moss, textDecoration: 'underline' } as const;
