// ABOUTME: Entry point for the admin dashboard SPA — mounts the React app.
// ABOUTME: Routing and data layers land with the dashboard issue.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

const root = document.getElementById('root');
if (!root) {
	throw new Error('Missing #root element');
}

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
