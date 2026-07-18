// ABOUTME: Console auth (PRD §16, design v2) — magic-code sign-in: email, then a six-digit code.
// ABOUTME: The first-ever sign-in creates the account; sessions are bearer tokens in storage.

import { createContext, type ReactNode, useContext, useState } from 'react';
import { AccentButton, BeanMark, InkButton } from '../components/ui.js';
import { clearToken, getToken, publicApi, setAdminEmail, setToken } from './api.js';

interface AuthState {
	token: string | null;
	signIn: (token: string, email?: string) => void;
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
		signIn: (t, email) => {
			setToken(t);
			if (email) setAdminEmail(email);
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

const loginInput =
	'w-full rounded-[9px] border border-ink/18 bg-card px-[13px] py-[11px] text-[14px] text-ink shadow-[0_1px_1px_rgba(26,26,25,0.03)] outline-none focus:border-positive focus:shadow-[0_0_0_3px_rgba(77,107,22,0.15)]';

export function LoginScreen() {
	const { signIn } = useAuth();
	const [step, setStep] = useState<'email' | 'code'>('email');
	const [email, setEmail] = useState('');
	const [code, setCode] = useState('');
	const [adminToken, setAdminTokenInput] = useState('');
	const [showTokenInput, setShowTokenInput] = useState(false);
	// The email/code path and the self-host token path can be on screen at the
	// same time, so each tracks its own pending and error state.
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [tokenError, setTokenError] = useState<string | null>(null);
	const [tokenBusy, setTokenBusy] = useState(false);

	async function requestCode() {
		setError(null);
		setBusy(true);
		try {
			await publicApi('POST', '/auth/request-code', { email });
			setStep('code');
			setCode('');
		} catch {
			setError("Couldn't send a code. Check the email address and try again.");
		} finally {
			setBusy(false);
		}
	}

	async function tokenSignIn() {
		setTokenError(null);
		setTokenBusy(true);
		try {
			// Prove the token works before storing it, so a typo can't strand
			// the user inside a dashboard of 401s.
			const res = await fetch('/admin/stats', {
				headers: { Authorization: `Bearer ${adminToken}` },
			});
			if (!res.ok) throw new Error('unauthorized');
			signIn(adminToken);
		} catch {
			setTokenError("That token didn't work. Check ADMIN_TOKEN in your env.");
		} finally {
			setTokenBusy(false);
		}
	}

	async function verify() {
		setError(null);
		setBusy(true);
		try {
			const res = await publicApi<{ token: string }>('POST', '/auth/verify', { email, code });
			signIn(res.token, email);
		} catch {
			setError("That code didn't work. Check it, or request a fresh one.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="relative flex h-screen flex-col items-center justify-center overflow-y-auto bg-card px-6 py-10">
			<div className="pointer-events-none absolute right-0 bottom-0 left-0 h-[32vh] bg-[linear-gradient(175deg,rgba(200,255,77,0)_0%,rgba(200,255,77,0.10)_45%,rgba(163,224,60,0.22)_100%)]" />
			<div className="absolute top-[26px] left-8 flex items-center gap-[9px]">
				<BeanMark size={30} />
				<span className="font-semibold text-[15.5px] tracking-[-0.01em]">Cool Beans</span>
			</div>

			<div className="cbin relative w-full max-w-[440px] rounded-[14px] border border-ink/7 bg-card px-10 pt-10 pb-[34px] shadow-[0_15px_35px_rgba(56,60,50,0.09),0_5px_15px_rgba(0,0,0,0.06)]">
				{step === 'email' ? (
					<div>
						<h1 className="m-0 mb-1.5 font-semibold text-[24px] text-ink-heading tracking-[-0.015em]">
							Sign in to Cool Beans
						</h1>
						<p className="m-0 mb-6 text-[13.5px] text-ink-muted leading-normal">
							We'll email you a six-digit code for a password-free sign in. First sign-in creates
							your account.
						</p>
						<label className="block font-medium text-[12.5px] text-ink-body" htmlFor="login-email">
							Email
						</label>
						<input
							id="login-email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							onKeyDown={(e) => e.key === 'Enter' && email && requestCode()}
							placeholder="you@company.com"
							className={`${loginInput} mt-[7px]`}
						/>
						{error ? <p className="mt-2 mb-0 text-[12.5px] text-danger">{error}</p> : null}
						<AccentButton
							className="mt-[18px] w-full justify-center py-[11px] text-[14px]"
							onClick={() => email && requestCode()}
						>
							{busy ? 'Sending…' : 'Email me a code'}
						</AccentButton>
						<div className="my-[22px] flex items-center gap-3">
							<div className="h-px flex-1 bg-ink/9" />
							<span className="text-[11.5px] text-[#a8a89f]">SELF-HOSTING?</span>
							<div className="h-px flex-1 bg-ink/9" />
						</div>
						{showTokenInput ? (
							<div>
								<input
									type="password"
									value={adminToken}
									onChange={(e) => setAdminTokenInput(e.target.value)}
									onKeyDown={(e) => e.key === 'Enter' && adminToken && tokenSignIn()}
									placeholder="ADMIN_TOKEN"
									className={`${loginInput} font-mono text-[13px]`}
								/>
								{tokenError ? (
									<p className="mt-2 mb-0 text-[12.5px] text-danger">{tokenError}</p>
								) : null}
								<InkButton
									className="mt-2.5 w-full justify-center py-[11px] text-[14px]"
									onClick={() => adminToken && tokenSignIn()}
								>
									{tokenBusy ? 'Checking…' : 'Sign in with token'}
								</InkButton>
							</div>
						) : (
							<p className="m-0 text-center text-[12.5px] text-ink-faint leading-[1.6]">
								Running your own instance? Sign in with the{' '}
								<button
									type="button"
									onClick={() => setShowTokenInput(true)}
									className="cursor-pointer border-none bg-transparent p-0 font-mono text-[12.5px] text-ink-muted underline decoration-ink/20 hover:text-ink"
								>
									ADMIN_TOKEN
								</button>{' '}
								from your env instead.
							</p>
						)}
					</div>
				) : (
					<div className="cbin">
						<span className="mb-[18px] inline-flex h-12 w-12 items-center justify-center rounded-[10px] bg-positive-tint">
							<svg
								width="26"
								height="26"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#4d6b16"
								strokeWidth="1.9"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M3 7l9 6 9-6" />
								<rect x="3" y="5" width="18" height="14" rx="2" />
							</svg>
						</span>
						<h1 className="m-0 mb-1.5 font-semibold text-[21px] tracking-[-0.015em]">
							Check your inbox
						</h1>
						<p className="m-0 mb-5 text-[13.5px] text-ink-muted leading-[1.55]">
							We sent a six-digit code to <strong className="text-ink">{email}</strong>. Enter it
							below — it expires in 10 minutes.
						</p>
						<input
							inputMode="numeric"
							autoComplete="one-time-code"
							maxLength={6}
							value={code}
							onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
							onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && verify()}
							placeholder="000000"
							aria-label="Six-digit code"
							className="mb-4 w-full rounded-[10px] border border-ink/9 bg-fill-soft px-[13px] py-[11px] text-center font-mono text-[24px] text-ink tracking-[8px] outline-none focus:border-positive"
						/>
						{error ? <p className="mt-0 mb-3 text-[12.5px] text-danger">{error}</p> : null}
						<InkButton
							className="w-full justify-center py-[11px] text-[14px]"
							onClick={() => code.length === 6 && verify()}
						>
							{busy ? 'Verifying…' : 'Sign in'}
						</InkButton>
						<div className="mt-4 flex justify-center gap-[18px] text-[12.5px]">
							<button
								type="button"
								onClick={() => requestCode()}
								className="cursor-pointer border-none bg-transparent p-0 text-[12.5px] text-positive"
							>
								Resend code
							</button>
							<button
								type="button"
								onClick={() => {
									setStep('email');
									setCode('');
									setError(null);
								}}
								className="cursor-pointer border-none bg-transparent p-0 text-[12.5px] text-ink-faint hover:text-ink"
							>
								Use a different email
							</button>
						</div>
					</div>
				)}
			</div>

			<p className="relative m-0 mt-[22px] text-center text-[12px] text-ink-faint leading-[1.6]">
				New to Cool Beans?{' '}
				<a href="https://github.com/GoldenBerry-SO/coolbeans" target="_blank" rel="noreferrer">
					Self-host it free
				</a>{' '}
				·{' '}
				<a
					href="https://github.com/GoldenBerry-SO/coolbeans/tree/main/docs"
					target="_blank"
					rel="noreferrer"
				>
					Docs
				</a>
				<br />
				<span className="text-ink-ghost">
					Protected by constant-time token checks. We never store passwords.
				</span>
			</p>
		</div>
	);
}
