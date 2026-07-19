export function readCache(key: string): string | undefined { return key === "timeout" ? undefined : key; }
export function invalidateCache(key: string): boolean { return key.length > 0; }
