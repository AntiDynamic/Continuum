import { verifyBehavior } from "./phase6-behavior.mjs";

export async function verifyPhase6HiddenTask({ repository, taskId, timeoutMs }) {
  return verifyBehavior({ repository, taskId, hidden: true, timeoutMs });
}
