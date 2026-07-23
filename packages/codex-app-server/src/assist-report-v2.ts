import type { Db } from "@continuum/database";
import { buildShadowReport, type ShadowFlightRecorderReport } from "./report.js";
import { parseAssistContextEnvelope, type AssistContextEnvelope } from "./assist-context-envelope.js";
import { parseAssistContextToolResult, type AssistContextToolResult } from "./assist-tool-result.js";
import type { BoundedVerifierResult } from "./bounded-verifier.js";

export const ASSIST_FLIGHT_RECORDER_SCHEMA_VERSION =
  "continuum.assist-flight-recorder.v1" as const;

interface InjectionRow {
  injection_sequence: number;
  envelope_size_bytes: number;
  source_role: string;
  serialized_envelope: string | null;
  envelope_sha256: string | null;
  schema_version: string | null;
  delivery_id: string | null;
  estimated_tokens: number | null;
  created_at: string | null;
}
interface ToolEventRow {
  call_id: string;
  tool_name: string;
  event_type: string;
  raw_sequence_number: number | null;
  delivery_id: string | null;
  arguments_hash: string | null;
  result_hash: string | null;
  result_json: string | null;
  failure_code: string | null;
}
interface SignalRow { signal_type: string; decision_json: string | null }

export interface AssistFlightRecorderReport {
  schemaVersion: typeof ASSIST_FLIGHT_RECORDER_SCHEMA_VERSION;
  execution: ShadowFlightRecorderReport["execution"];
  activity: ShadowFlightRecorderReport["exploration"];
  usage: ShadowFlightRecorderReport["usage"];
  outcome: ShadowFlightRecorderReport["outcome"];
  initialContext: {
    deliveryId: string | null;
    schema: string | null;
    hash: string | null;
    bytes: number;
    estimatedTokens: number | null;
    requiredItems: number;
    recommendedItems: number;
    optionalItems: number;
    restoredItems: number;
    references: number;
    packetSections: Record<string, number>;
    coverageAdded: string[];
    coverageRemaining: string[];
  };
  nativeToolActivity: {
    requested: number;
    validated: number;
    successful: number;
    refused: number;
    failed: number;
    newItems: number;
    restoredItems: number;
    references: number;
    omittedItems: number;
    estimatedNewTokens: number;
    estimatedRestoredTokens: number;
    estimatedDuplicateTokensAvoided: number;
    resultLimitRefusals: number;
    sessionLimitRefusals: number;
    toolCallLimitRefusals: number;
  };
  contextSignals: {
    count: number;
    types: Record<string, number>;
    sessionDecisions: number;
    deliveriesTriggered: number;
  };
  provenance: Array<{
    callId: string;
    tool: string;
    rawRequestSequence: number | null;
    rawResponseSequence: number | null;
    deliveryId: string | null;
    argumentsHash: string | null;
    resultHash: string | null;
  }>;
  verification: null | {
    command: string;
    exitCode: number | null;
    durationMs: number;
    timedOut: boolean;
    stdoutHash: string;
    stderrHash: string;
    stdoutExcerpt: string;
    stderrExcerpt: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    passed: boolean;
  };
  injections: Array<{
    sequence: number;
    sourceRole: string;
    byteCount: number;
    sha256: string | null;
    schemaVersion: string | null;
    deliveryId: string | null;
    estimatedTokens: number | null;
    createdAt: string | null;
  }>;
  evidenceWarnings: string[];
}

const countBy = (values: string[]): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
};

export function buildAssistFlightRecorderReport(
  db: Db,
  executionId: string,
  repositoryRoot: string,
  verifier?: { command: string; result: BoundedVerifierResult },
): AssistFlightRecorderReport {
  const shadow = buildShadowReport(db, executionId, repositoryRoot);
  const injections = db.prepare(
    "SELECT injection_sequence,envelope_size_bytes,source_role,serialized_envelope,envelope_sha256,schema_version,delivery_id,estimated_tokens,created_at FROM codex_assist_injections WHERE execution_id=? ORDER BY injection_sequence",
  ).all(executionId) as unknown as InjectionRow[];
  const events = db.prepare(
    "SELECT call_id,tool_name,event_type,raw_sequence_number,delivery_id,arguments_hash,result_hash,result_json,failure_code FROM codex_assist_tool_call_events_v2 WHERE execution_id=? ORDER BY created_at,rowid",
  ).all(executionId) as unknown as ToolEventRow[];
  const sessionId = db.prepare("SELECT session_id FROM codex_executions WHERE id=?").get(executionId) as
    | { session_id: string }
    | undefined;
  const signals = sessionId
    ? db.prepare("SELECT signal_type,decision_json FROM context_session_signals WHERE session_id=? ORDER BY created_at").all(sessionId.session_id) as unknown as SignalRow[]
    : [];
  let initialEnvelope: AssistContextEnvelope | null = null;
  const initial = injections.find((entry) => entry.source_role === "initial");
  if (initial?.serialized_envelope) {
    try { initialEnvelope = parseAssistContextEnvelope(initial.serialized_envelope); } catch {}
  }
  const results: AssistContextToolResult[] = [];
  for (const event of events) {
    if (event.event_type !== "response_sent" || !event.result_json) continue;
    try { results.push(parseAssistContextToolResult(event.result_json)); } catch {}
  }
  const deliveryResults = events.filter((entry) => entry.event_type === "delivery_created" || (entry.event_type === "signal_decision" && entry.delivery_id !== null));
  const refusalCodes = events.filter((entry) => entry.event_type === "refused").map((entry) => entry.failure_code);
  const calls = new Map<string, ToolEventRow[]>();
  for (const event of events) calls.set(event.call_id, [...(calls.get(event.call_id) ?? []), event]);
  return {
    schemaVersion: ASSIST_FLIGHT_RECORDER_SCHEMA_VERSION,
    execution: shadow.execution,
    activity: shadow.exploration,
    usage: shadow.usage,
    outcome: shadow.outcome,
    initialContext: {
      deliveryId: initial?.delivery_id ?? null,
      schema: initial?.schema_version ?? null,
      hash: initial?.envelope_sha256 ?? null,
      bytes: initial?.envelope_size_bytes ?? 0,
      estimatedTokens: initial?.estimated_tokens ?? null,
      requiredItems: initialEnvelope?.items.filter((item) => item.requirementState === "required").length ?? 0,
      recommendedItems: initialEnvelope?.items.filter((item) => item.requirementState === "recommended").length ?? 0,
      optionalItems: initialEnvelope?.items.filter((item) => item.requirementState === "optional").length ?? 0,
      restoredItems: 0,
      references: initialEnvelope?.references.length ?? 0,
      packetSections: countBy(initialEnvelope?.items.map((item) => item.packetSection) ?? []),
      coverageAdded: initialEnvelope?.coverage.added ?? [],
      coverageRemaining: initialEnvelope?.coverage.remaining ?? [],
    },
    nativeToolActivity: {
      requested: events.filter((entry) => entry.event_type === "requested").length,
      validated: events.filter((entry) => entry.event_type === "validated").length,
      successful: events.filter((entry) => entry.event_type === "response_sent" && !entry.failure_code).length,
      refused: events.filter((entry) => entry.event_type === "refused").length,
      failed: events.filter((entry) => entry.event_type === "failed").length,
      newItems: results.reduce((total, result) => total + result.newItems.length, 0),
      restoredItems: results.reduce((total, result) => total + result.restoredItems.length, 0),
      references: results.reduce((total, result) => total + result.references.length, 0),
      omittedItems: results.reduce((total, result) => total + result.omittedItems.length, 0),
      estimatedNewTokens: results.reduce((total, result) => total + result.estimatedNewTokens, 0),
      estimatedRestoredTokens: results.reduce((total, result) => total + result.estimatedRestoredTokens, 0),
      estimatedDuplicateTokensAvoided: results.reduce((total, result) => total + result.estimatedDuplicateTokensAvoided, 0),
      resultLimitRefusals: refusalCodes.filter((code) => code === "RESULT_TOKEN_LIMIT").length,
      sessionLimitRefusals: refusalCodes.filter((code) => code === "SESSION_TOKEN_LIMIT").length,
      toolCallLimitRefusals: refusalCodes.filter((code) => code === "TOOL_CALL_LIMIT").length,
    },
    contextSignals: {
      count: signals.length,
      types: countBy(signals.map((signal) => signal.signal_type)),
      sessionDecisions: signals.filter((signal) => signal.decision_json !== null).length,
      deliveriesTriggered: deliveryResults.filter((entry) => entry.tool_name === "continuum_report_context_signal").length,
    },
    provenance: [...calls.entries()].map(([callId, chain]) => {
      const request = chain.find((entry) => entry.event_type === "requested" || entry.event_type === "signal_received");
      const response = chain.find((entry) => entry.event_type === "response_sent");
      const delivery = chain.find((entry) => entry.event_type === "delivery_created");
      return {
        callId,
        tool: request?.tool_name ?? response?.tool_name ?? "unknown",
        rawRequestSequence: request?.raw_sequence_number ?? null,
        rawResponseSequence: response?.raw_sequence_number ?? null,
        deliveryId: delivery?.delivery_id ?? response?.delivery_id ?? null,
        argumentsHash: request?.arguments_hash ?? null,
        resultHash: response?.result_hash ?? delivery?.result_hash ?? null,
      };
    }),
    verification: verifier ? {
      command: verifier.command,
      exitCode: verifier.result.exitCode,
      durationMs: verifier.result.durationMs,
      timedOut: verifier.result.timedOut,
      stdoutHash: verifier.result.stdoutHash,
      stderrHash: verifier.result.stderrHash,
      stdoutExcerpt: verifier.result.stdoutExcerpt,
      stderrExcerpt: verifier.result.stderrExcerpt,
      stdoutTruncated: verifier.result.stdoutTruncated,
      stderrTruncated: verifier.result.stderrTruncated,
      passed: verifier.result.success,
    } : null,
    injections: injections.map((entry) => ({
      sequence: entry.injection_sequence,
      sourceRole: entry.source_role,
      byteCount: entry.envelope_size_bytes,
      sha256: entry.envelope_sha256,
      schemaVersion: entry.schema_version,
      deliveryId: entry.delivery_id,
      estimatedTokens: entry.estimated_tokens,
      createdAt: entry.created_at,
    })),
    evidenceWarnings: [
      ...shadow.evidenceWarnings,
      "Continuum context token values are estimates.",
      "Normal repository access remained enabled.",
      "Activity evidence is not complete model-visible context.",
      "A single matched pair does not establish causal savings.",
    ],
  };
}
