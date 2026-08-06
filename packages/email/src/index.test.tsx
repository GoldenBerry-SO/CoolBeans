// ABOUTME: Tests for email templates — renders the key-delivery email to HTML.
// ABOUTME: Asserts the §14 content rules (yearly extras only when provided) and images-off safety.

import { describe, expect, it } from 'vitest';
import { KeyRecoveryEmail, LicenseKeyEmail, MagicCodeEmail, render } from './index.js';

describe('LicenseKeyEmail', () => {
	it('renders the key and product name', async () => {
		const html = await render(
			<LicenseKeyEmail productName="Clementine" licenseKey="CLEM-A2B3-C4D5-E6F7" />,
		);
		expect(html).toContain('CLEM-A2B3-C4D5-E6F7');
		expect(html).toContain('Clementine');
		expect(html).not.toContain('renews on');
	});

	it('shows the logo when a source is given, and nothing when it is not', async () => {
		const withLogo = await render(
			<LicenseKeyEmail
				productName="Clementine"
				licenseKey="CLEM-A2B3-C4D5-E6F7"
				logoSrc="cid:product-icon"
			/>,
		);
		expect(withLogo).toContain('cid:product-icon');

		const without = await render(
			<LicenseKeyEmail productName="Clementine" licenseKey="CLEM-A2B3-C4D5-E6F7" />,
		);
		expect(without).not.toContain('<img');
	});

	it('names the product in text, so a client that blocks images still shows the brand', async () => {
		// The regression this guards: branding used to live only in the logo image and its alt
		// text, so an email read in a client with remote images off looked like it came from
		// nobody. The wordmark is a real text node now.
		const html = await render(
			<LicenseKeyEmail
				productName="Clementine"
				licenseKey="CLEM-A2B3-C4D5-E6F7"
				logoSrc="cid:product-icon"
			/>,
		);
		const withoutTags = html.replace(/<[^>]*>/g, ' ');
		expect(withoutTags).toContain('Clementine');
	});

	it('keeps the key out of the preview text', async () => {
		// Preview text renders in the inbox list next to the subject, where anyone glancing at
		// the screen can read it. The credential does not belong there.
		const html = await render(
			<LicenseKeyEmail productName="Clementine" licenseKey="CLEM-A2B3-C4D5-E6F7" />,
		);
		const preview = html.slice(0, html.indexOf('</div>'));
		expect(preview).not.toContain('CLEM-A2B3-C4D5-E6F7');
	});

	it('includes renewal date and portal link for yearly licenses', async () => {
		const html = await render(
			<LicenseKeyEmail
				productName="Clementine"
				licenseKey="CLEM-A2B3-C4D5-E6F7"
				renewalDate="2027-07-17"
				portalUrl="https://app.coolbeans.tools/portal"
			/>,
		);
		expect(html).toContain('renews on');
		expect(html).toContain('2027-07-17');
		expect(html).toContain('https://app.coolbeans.tools/portal');
	});

	it('renders a download button only when a URL is configured', async () => {
		const html = await render(
			<LicenseKeyEmail
				productName="Clementine"
				licenseKey="CLEM-A2B3-C4D5-E6F7"
				downloadUrl="https://clementine.app/download"
			/>,
		);
		expect(html).toContain('https://clementine.app/download');
		expect(html).toContain('Download Clementine');
	});
});

describe('MagicCodeEmail', () => {
	it('renders the code and its expiry, and keeps the code out of the preview', async () => {
		const html = await render(<MagicCodeEmail code="123456" expiresMinutes={10} />);
		expect(html).toContain('123456');
		expect(html).toContain('10 minutes');
		const preview = html.slice(0, html.indexOf('</div>'));
		expect(preview).not.toContain('123456');
	});
});

describe('KeyRecoveryEmail', () => {
	it('lists every key with its product and status', async () => {
		const html = await render(
			<KeyRecoveryEmail
				keys={[
					{ key: 'CLEM-A2B3-C4D5-E6F7', product: 'Clementine', status: 'active' },
					{ key: 'TIDE-1111-2222-3333', product: 'TideGlass', status: 'disabled' },
				]}
			/>,
		);
		expect(html).toContain('CLEM-A2B3-C4D5-E6F7');
		expect(html).toContain('TIDE-1111-2222-3333');
		expect(html).toContain('Clementine');
		expect(html).toContain('TideGlass');
		expect(html).toContain('disabled');
	});

	it('speaks in the singular for a single key', async () => {
		const html = await render(
			<KeyRecoveryEmail
				keys={[{ key: 'CLEM-A2B3-C4D5-E6F7', product: 'Clementine', status: 'active' }]}
			/>,
		);
		expect(html).toContain('Your license key');
		expect(html).not.toContain('Your license keys');
	});
});
