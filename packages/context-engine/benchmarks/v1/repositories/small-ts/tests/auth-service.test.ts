import { AuthService } from "../src/auth-service";
export function rejectsEmptyTokenTest(): boolean { try { new AuthService().validateToken(""); return false; } catch { return true; } }
