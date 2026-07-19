// ABOUTME: Shared class-name composition helper used by shadcn UI primitives.
// ABOUTME: Combines conditional classes and resolves conflicting Tailwind utilities.

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
