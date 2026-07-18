// ABOUTME: Console-wide UI state — the product scope switcher and the header search query.
// ABOUTME: 'all' means no narrowing; pages read both and filter their rows client-side.

import { createContext, type ReactNode, useContext, useState } from 'react';

interface ScopeState {
	scope: string;
	setScope: (slug: string) => void;
	query: string;
	setQuery: (q: string) => void;
}

const ScopeContext = createContext<ScopeState | null>(null);

export function useScope(): ScopeState {
	const ctx = useContext(ScopeContext);
	if (!ctx) throw new Error('useScope outside ScopeProvider');
	return ctx;
}

export function ScopeProvider({ children }: { children: ReactNode }) {
	const [scope, setScope] = useState('all');
	const [query, setQuery] = useState('');
	return (
		<ScopeContext.Provider value={{ scope, setScope, query, setQuery }}>
			{children}
		</ScopeContext.Provider>
	);
}

/** Per-product identity color, matched to the design's palette by stable index. */
const PRODUCT_COLORS = ['#e8863a', '#7b6cf0', '#2fa89b', '#d4a017', '#c05299', '#b5651d'];

export function productColor(index: number): string {
	return PRODUCT_COLORS[index % PRODUCT_COLORS.length];
}
