// ABOUTME: Auth gate for the console (PRD §16, §26) — token present renders the Shell, else login.
// ABOUTME: The customer portal route sits outside this gate (it is public).

import { LoginScreen, useAuth } from '../lib/auth.js';
import { Shell } from './Shell.js';

export function ConsoleLayout() {
	const { token } = useAuth();
	if (!token) return <LoginScreen />;
	return <Shell />;
}
