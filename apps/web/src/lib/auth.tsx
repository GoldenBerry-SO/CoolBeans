// ABOUTME: Console auth (PRD §16, design v2) — magic-code sign-in: email, then a six-digit code.
// ABOUTME: The first-ever sign-in creates the account; sessions are bearer tokens in storage.

import { createContext, type ReactNode, useContext, useState } from 'react';
import { AccentButton, BeanMark } from '../components/ui.js';
import { clearToken, getToken, publicApi, setToken } from './api.js';

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
			const current = getToken();
			if (current) {
				// Best effort: revoke the session server-side; local state clears regardless.
				fetch('/auth/signout', {
					method: 'POST',
					headers: { Authorization: `Bearer ${current}` },
				}).catch(() => {});
			}
			clearToken();
			setTok(null);
		},
	};
	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const inputClass =
	'w-full rounded-[10px] border border-ink/14 bg-fill-soft px-3.5 py-3 text-[14px] outline-none focus:border-positive focus:bg-card';

export function LoginScreen() {
	const { signIn } = useAuth();
	const [step, setStep] = useState<'email' | 'code'>('email');
	const [email, setEmail] = useState('');
	const [name, setName] = useState('');
	const [code, setCode] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function requestCode() {
		setError(null);
		setBusy(true);
		try {
			await publicApi('POST', '/auth/request-code', { email });
			setStep('code');
		} catch {
			setError('That does not look like a valid email.');
		} finally {
			setBusy(false);
		}
	}

	async function verify() {
		setError(null);
		setBusy(true);
		try {
			const res = await publicApi<{ token: string }>('POST', '/auth/verify', {
				email,
				code,
				...(name ? { name } : {}),
			});
			signIn(res.token);
		} catch {
			setError("That code didn't work. Check it, or request a fresh one.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex h-screen items-center justify-center p-5">
			<div className="cbin w-full max-w-[420px] rounded-2xl border border-ink/10 bg-card p-8 shadow-[0_4px_24px_rgba(26,26,25,0.06)]">
				<div className="mb-4 flex items-center gap-2.5">
					<BeanMark size={30} />
					<span className="font-semibold text-[15px]">Cool Beans Console</span>
				</div>

				{step === 'email' ? (
					<>
						<h2 className="m-0 mb-1.5 font-semibold text-[20px] tracking-[-0.01em]">Sign in</h2>
						<p className="m-0 mb-5 text-[13.5px] text-ink-muted">
							We'll email you a six-digit code. No password to remember — first sign-in creates your
							account.
						</p>
						<label className="mb-3 block">
							<span className="mb-1.5 block font-semibold text-[11px] text-ink-muted uppercase tracking-[0.05em]">
								Email
							</span>
							<input
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && email && requestCode()}
								placeholder="you@goldenberry.io"
								className={inputClass}
							/>
						</label>
						<label className="mb-1 block">
							<span className="mb-1.5 block font-semibold text-[11px] text-ink-muted uppercase tracking-[0.05em]">
								Name <span className="font-normal normal-case">(first sign-in only)</span>
							</span>
							<input
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Chris"
								className={inputClass}
							/>
						</label>
						{error ? <p className="mt-2 mb-0 text-[12.5px] text-danger">{error}</p> : null}
						<AccentButton
							className="mt-4 w-full justify-center"
							onClick={() => email && requestCode()}
						>
							{busy ? 'Sending…' : 'Email me a code'}
						</AccentButton>
					</>
				) : (
					<>
						<h2 className="m-0 mb-1.5 font-semibold text-[20px] tracking-[-0.01em]">
							Check your email
						</h2>
						<p className="m-0 mb-5 text-[13.5px] text-ink-muted">
							We sent a six-digit code to <span className="font-medium text-ink">{email}</span>. It
							expires in 10 minutes.
						</p>
						<label className="mb-1 block">
							<span className="mb-1.5 block font-semibold text-[11px] text-ink-muted uppercase tracking-[0.05em]">
								Code
							</span>
							<input
								inputMode="numeric"
								autoComplete="one-time-code"
								maxLength={6}
								value={code}
								onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
								onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && verify()}
								placeholder="000000"
								className={`${inputClass} text-center font-mono text-[24px] tracking-[8px]`}
							/>
						</label>
						{error ? <p className="mt-2 mb-0 text-[12.5px] text-danger">{error}</p> : null}
						<AccentButton
							className="mt-4 w-full justify-center"
							onClick={() => code.length === 6 && verify()}
						>
							{busy ? 'Verifying…' : 'Sign in'}
						</AccentButton>
						<div className="mt-4 text-center">
							<button
								type="button"
								className="cursor-pointer border-none bg-transparent text-[12.5px] text-ink-faint hover:text-ink"
								onClick={() => {
									setStep('email');
									setCode('');
									setError(null);
								}}
							>
								Use a different email
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
