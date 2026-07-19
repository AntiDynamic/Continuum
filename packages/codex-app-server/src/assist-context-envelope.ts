import type { DeltaContextPacket } from "@continuum/shared";

export function buildContextEnvelope(packet: DeltaContextPacket): string {
  let xml = `<continuum_context>\n`;
  for (const item of packet.newItems) {
    const candidate = item.candidate.item;
    xml += `  <file path="${candidate.source_path}">\n`;
    if (candidate.contextual_header) {
      xml += `    <header>\n${candidate.contextual_header}\n    </header>\n`;
    }
    xml += `    <content>\n${item.content}\n    </content>\n`;
    xml += `  </file>\n`;
  }
  xml += `</continuum_context>`;
  return xml;
}
