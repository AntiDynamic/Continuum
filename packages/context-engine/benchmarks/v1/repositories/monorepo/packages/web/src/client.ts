import type { UserResponse } from "../../api/src/contracts";
export async function fetchUser(id: string): Promise<UserResponse> { return { id, sessionId: "session-" + id }; }
