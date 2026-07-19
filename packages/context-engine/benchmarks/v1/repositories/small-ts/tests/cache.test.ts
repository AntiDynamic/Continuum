import { readCache } from "../src/cache";
export function cacheTimeoutTest(): boolean { return readCache("timeout") === undefined; }
