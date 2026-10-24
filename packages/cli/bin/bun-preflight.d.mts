export const MINIMUM_BUN_VERSION: string;
export function supportedBunVersion(version: string | undefined): boolean;
export function bunVersionError(version?: string): string | null;
export function enforceBunVersion(): void;
