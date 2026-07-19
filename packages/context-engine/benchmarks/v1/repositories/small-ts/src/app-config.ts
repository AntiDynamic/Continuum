export interface AppConfig { timeoutMs: number; trustProxy: boolean; }
export function loadAppConfig(): AppConfig { return { timeoutMs: 5000, trustProxy: false }; }
