import type { DeltaContextPacket } from "./context-session.js";

/** The exact model-visible text. Audit metadata and omitted source remain outside it. */
export function renderContextDelivery(packet: Pick<DeltaContextPacket, "sessionId" | "newItems" | "restoredItems" | "activeReferences" | "coverageRemaining" | "cacheDelivery">): string {
  return [
    packet.cacheDelivery?.stablePrefix.content ?? "",
    `SESSION: ${packet.sessionId}`,
    ...[...(packet.newItems??[]),...(packet.restoredItems??[])].map(entry => `${entry.candidate.item.source_path}:${entry.candidate.item.source_start_line}-${entry.candidate.item.source_end_line}\n${entry.candidate.item.content??entry.content}`),
    ...(packet.activeReferences??[]).map(entry => `Already delivered: ${entry.sourcePath}${entry.title ? "#"+entry.title : ""}`),
    ...((packet.coverageRemaining??[]).length ? [`Required context missing: ${packet.coverageRemaining.join(", ")}. Request targeted context before assuming completeness.`] : []),
  ].filter(Boolean).join("\n\n");
}
