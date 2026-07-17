// ABOUTME: Tests for email templates — renders the key-delivery email to HTML.
// ABOUTME: Asserts the §14 content rules (yearly extras only when provided).

import { describe, expect, it } from 'vitest';
import { LicenseKeyEmail, render } from './index.js';

describe('LicenseKeyEmail', () => {
	it('renders the key and product name', async () => {
		const html = await render(
			<LicenseKeyEmail productName="Clementine" licenseKey="CLEM-A2B3-C4D5-E6F7" />,
		);
		expect(html).toContain('CLEM-A2B3-C4D5-E6F7');
		expect(html).toContain('Clementine');
		expect(html).not.toContain('renews on');
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
});
