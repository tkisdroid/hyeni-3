import type { Plugin } from 'vite';
export function isDeferredLocaleChunk(moduleIds: string[]): boolean;
export function deferredLocalePrecachePlugin(deferredUrls: Set<string>): Plugin;
