import type { ContextRecoveryPacket } from "@continuum/shared";
import type { CodexAutoCompactionOptions } from "./protocol.js";

/**
 * Build a small, stable instruction that tells Codex what must survive a
 * provider-owned compaction pass. The full context remains in Continuum and
 * can be requested again; this prompt only carries the recovery coordinates.
 */
export function buildContinuumCompactionPrompt(recovery: ContextRecoveryPacket): string {
  const activeContext = recovery.activeContext
    .slice(0, 12)
    .map((item) => `${item.sourcePath}${item.title ? ` (${item.title})` : ""}`)
    .join(", ");

  return [
    "Preserve a concise, actionable continuation state for this coding task after context compaction.",
    `Continuum session: ${recovery.sessionId}`,
    `Task: ${recovery.task}`,
    `Status: ${recovery.status}`,
    `Next action: ${recovery.nextAction}`,
    `Required coverage remaining: ${recovery.coverageRemaining.join(", ") || "none"}`,
    `Blockers: ${recovery.blockers.join(" | ") || "none"}`,
    `Active context paths: ${activeContext || "none recorded"}`,
    "Keep exact file paths, blockers, required coverage, and the next action. Do not reproduce source contents; Continuum stores them persistently.",
  ].join("\n");
}

export function withContinuumCompactionPrompt(
  policy: CodexAutoCompactionOptions | undefined,
  recovery: ContextRecoveryPacket,
): CodexAutoCompactionOptions {
  return {
    ...policy,
    prompt: buildContinuumCompactionPrompt(recovery),
  };
}
