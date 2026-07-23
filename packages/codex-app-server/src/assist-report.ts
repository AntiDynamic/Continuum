import type { Db } from "@continuum/database";
import { buildShadowReport, type ShadowFlightRecorderReport } from "./report.js";

export const ASSIST_FLIGHT_RECORDER_SCHEMA_VERSION = "continuum.assist-flight-recorder.v1" as const;
interface InjectionRow { injection_sequence:number; envelope_size_bytes:number; source_role:string; serialized_envelope:string|null; envelope_sha256:string|null; schema_version:string|null; delivery_id:string|null; estimated_tokens:number|null; created_at:string|null; }
interface ToolRow { tool_name:string; arguments_json:string; response_success:number; response_content_items_json:string; }
export interface AssistFlightRecorderReport {
  schemaVersion:typeof ASSIST_FLIGHT_RECORDER_SCHEMA_VERSION;
  execution:ShadowFlightRecorderReport["execution"];
  activity:ShadowFlightRecorderReport["exploration"];
  usage:ShadowFlightRecorderReport["usage"];
  outcome:ShadowFlightRecorderReport["outcome"];
  injections:Array<{sequence:number;sourceRole:string;byteCount:number;sha256:string|null;schemaVersion:string|null;deliveryId:string|null;estimatedTokens:number|null;createdAt:string|null}>;
  toolCalls:Array<{toolName:string;argumentsJson:string;success:boolean;responseContentItemsJson:string}>;
  evidenceWarnings:string[];
}
export function buildAssistFlightRecorderReport(db:Db,executionId:string,repositoryRoot:string):AssistFlightRecorderReport {
  const shadow=buildShadowReport(db,executionId,repositoryRoot);
  const injections=db.prepare("SELECT injection_sequence,envelope_size_bytes,source_role,serialized_envelope,envelope_sha256,schema_version,delivery_id,estimated_tokens,created_at FROM codex_assist_injections WHERE execution_id=? ORDER BY injection_sequence").all(executionId) as unknown as InjectionRow[];
  const toolCalls=db.prepare("SELECT tool_name,arguments_json,response_success,response_content_items_json FROM codex_assist_tool_call_events WHERE execution_id=? ORDER BY rowid").all(executionId) as unknown as ToolRow[];
  return {schemaVersion:ASSIST_FLIGHT_RECORDER_SCHEMA_VERSION,execution:shadow.execution,activity:shadow.exploration,usage:shadow.usage,outcome:shadow.outcome,injections:injections.map((row)=>({sequence:row.injection_sequence,sourceRole:row.source_role,byteCount:row.envelope_size_bytes,sha256:row.envelope_sha256,schemaVersion:row.schema_version,deliveryId:row.delivery_id,estimatedTokens:row.estimated_tokens,createdAt:row.created_at})),toolCalls:toolCalls.map((row)=>({toolName:row.tool_name,argumentsJson:row.arguments_json,success:row.response_success===1,responseContentItemsJson:row.response_content_items_json})),evidenceWarnings:[...shadow.evidenceWarnings,"Assist injection entries prove Continuum delivery, not complete model-visible context."]};
}