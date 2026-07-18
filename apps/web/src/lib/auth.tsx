// ABOUTME: Admin token gate (PRD §16, §26) — paste the admin bearer token to use the console.
// ABOUTME: A pragmatic token-paste login (stored locally); Better Auth sessions are a follow-up.

import { createContext, type ReactNode, useContext, useState } from 'react';
import { AccentButton, BeanMark } from '../components/ui.js';
import { clearToken, getToken, setToken } from './api.js';

interface AuthState {
	token: string | null;
	signIn: (token: string) => void;
	signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth outside AuthProvider');
	return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
	const [token, setTok] = useState<string | null>(getToken());
	const value: AuthState = {
		token,
		signIn: (t) => {
			setToken(t);
			setTok(t);
		},
		signOut: () => {
			clearToken();
			setTok(null);
		},
	};
	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function LoginScreen() {
	const { signIn } = useAuth();
	const [value, setValue] = useState('');
	return (
		<div className="flex h-screen items-center justify-center p-5">
			<div className="cbin w-full max-w-[420px] rounded-2xl border border-ink/10 bg-card p-8 shadow-[0_4px_24px_rgba(26,26,25,0.06)]">
				<div className="mb-4 flex items-center gap-2.5">
					<BeanMark size={30} />
					<span className="font-semibold text-[15px]">Cool Beans Console</span>
				</div>
				<h2 className="m-0 mb-1.5 font-semibold text-[20px] tracking-[-0.01em]">Sign in</h2>
				<p className="m-0 mb-5 text-[13.5px] text-ink-muted">
					Paste your admin token to manage products, keys, and customers.
				</p>
				<span className="block font-semibold text-[11px] text-ink-muted uppercase tracking-[0.05em]">
					Admin token
				</span>
				<input
					type="password"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder="cb_admin_…"
					className="mt-1.5 w-full rounded-[10px] border border-ink/14 bg-fill-soft px-3.5 py-3 font-mono text-[14px] outline-none focus:border-positive focus:bg-card"
				/>
				<AccentButton
					className="mt-4 w-full justify-center"
					onClick={() => value && signIn(value.trim())}
				>
					Enter the console
				</AccentButton>
			</div>
		</div>
	);
}
