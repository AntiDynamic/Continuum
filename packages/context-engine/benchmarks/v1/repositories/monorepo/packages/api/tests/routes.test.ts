import { updateUser } from "../src/routes";
export async function updateUserContractTest(): Promise<boolean> { const result = await updateUser("u1"); return result.id === "u1" && result.sessionId === "session-u1"; }
