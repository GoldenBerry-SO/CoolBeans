// ABOUTME: Smoke test for the dashboard root component.
// ABOUTME: Uses server rendering so no DOM environment is needed yet.

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

describe('App', () => {
	it('renders the app shell', () => {
		const html = renderToString(<App />);
		expect(html).toContain('Cool Beans');
	});
});
