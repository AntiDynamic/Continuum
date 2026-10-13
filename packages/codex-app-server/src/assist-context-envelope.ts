import { renderContextDelivery, type DeltaContextPacket } from "@continuum/shared";
export function buildContextEnvelope(packet: DeltaContextPacket): string {
  return packet.renderedContent ?? renderContextDelivery(packet);
}
