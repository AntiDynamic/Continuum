export interface WorkspaceSettings { apiBaseUrl: string; sessionTimeoutMs: number; }
export function loadWorkspaceSettings(): WorkspaceSettings { return { apiBaseUrl: "/api", sessionTimeoutMs: 10000 }; }
