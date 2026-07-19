import { createSession } from "../../core/src/session";
export async function updateUser(id: string): Promise<{ id: string; sessionId: string }> { return { id, sessionId: createSession(id).id }; }
