export interface TokenClaims { subject: string; expiresAt: number; }
export class AuthService { validateToken(token: string): TokenClaims { if (!token) throw new Error("missing token"); return { subject: token, expiresAt: Date.now() + 1000 }; } refreshToken(token: string): string { return this.validateToken(token).subject + "-refreshed"; } }
