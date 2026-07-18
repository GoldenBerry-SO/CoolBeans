// ABOUTME: Console-wide product scope — the sidebar switcher narrows every page to one product.
// ABOUTME: 'all' means no narrowing; pages read the scope and filter their queries client-side.

import { createContext, type ReactNode, useContext, useState } from 'react';

interface ScopeState {
	scope: string;
	setScope: (slug: string) => void;
}

const ScopeContext = createContext<ScopeState | null>(null);

export function useScope(): ScopeState {
	const ctx = useContext(ScopeContext);
	if (!ctx) throw new Error('useScope outside ScopeProvider');
	return ctx;
}

export function ScopeProvider({ children }: { children: ReactNode }) {
	const [scope, setScope] = useState('all');
	return <ScopeContext.Provider value={{ scope, setScope }}>{children}</ScopeContext.Provider>;
}

/** Per-product identity color, matched to the design's palette by stable index. */
const PRODUCT_COLORS = ['#e8863a', '#7b6cf0', '#2fa89b', '#d4a017', '#c05299', '#3e7cb1'];

export function productColor(index: number): string {
	return PRODUCT_COLORS[index % PRODUCT_COLORS.length];
}
