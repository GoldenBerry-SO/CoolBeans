// ABOUTME: Minimal stubs for Electron and Tauri so these examples type-check here.
// ABOUTME: They are not dependencies of this repo; real apps get the actual typings.

declare module 'electron' {
	export const app: { getPath(name: string): string };
}

declare module '@tauri-apps/plugin-fs' {
	export const BaseDirectory: { AppConfig: number };
	export function readTextFile(path: string, opts?: { baseDir?: number }): Promise<string>;
	export function writeTextFile(
		path: string,
		contents: string,
		opts?: { baseDir?: number },
	): Promise<void>;
}
