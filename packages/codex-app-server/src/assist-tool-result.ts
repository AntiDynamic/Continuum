import type { DeltaContextPacket } from "@continuum/shared";
import {
  createAssistContextEnvelope,
  serializeCanonical,
  type AssistEnvelopeItem,
  type AssistEnvelopeReference,
  itemValid,
  referenceValid,
} from "./assist-context-envelope.js";
import { isRecord } from "./json.js";

export const ASSIST_TOOL_RESULT_SCHEMA_VERSION = "continuum.assist-tool-result.v1" as const;

export interface AssistContextToolResult {
  schemaVersion: typeof ASSIST_TOOL_RESULT_SCHEMA_VERSION;
  success: boolean;
  sessionId: string;
  deliveryId: string | null;
  newItems: AssistEnvelopeItem[];
  restoredItems: AssistEnvelopeItem[];
  references: AssistEnvelopeReference[];
  omittedItems: Array<{ contextItemVersionId: string | null; sourcePath: string | null; reason: string; estimatedTokens: number }>;
  coverageAdded: string[];
  coverageRemaining: string[];
  estimatedNewTokens: number;
  estimatedRestoredTokens: number;
  estimatedDuplicateTokensAvoided: number;
  toolCallsUsed: number;
  remainingToolCalls: number;
  sessionEstimatedTokensUsed: number;
  remainingEstimatedTokens: number;
  incomplete: boolean;
  additionalEstimatedTokensRequired: number | null;
  limitReached: boolean;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface AssistToolResultOptions {
  maximumResultTokens: number;
  maximumToolCalls: number;
  toolCallsUsed: number;
  sessionEstimatedTokensUsed: number;
  remainingSessionTokens: number;
}

const priority = (item: AssistEnvelopeItem): number =>
  item.requirementState === "required" ? 0 : item.requirementState === "recommended" ? 1 : 2;

export function buildAssistContextToolResult(
  packet: DeltaContextPacket,
  options: AssistToolResultOptions,
): AssistContextToolResult {
  const complete = createAssistContextEnvelope(packet);
  const newIds = new Set(packet.newItems.map((entry) => entry.candidate.item.id));
  const ordered = complete.items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => priority(left.item) - priority(right.item) || left.index - right.index);
  const requiredTokens = ordered
    .filter(({ item }) => item.requirementState === "required")
    .reduce((total, { item }) => total + item.estimatedTokens, 0);
  const sessionRequired = packet.estimatedNewTokens + packet.estimatedRestoredTokens;
  const requiredBudgetOmission = sessionRequired === 0 && (packet.additionalEstimatedTokensRequired ?? 0) > 0;
  const resultLimitFailure = requiredTokens > options.maximumResultTokens || (requiredBudgetOmission && options.maximumResultTokens <= options.remainingSessionTokens);
  const sessionLimitFailure = sessionRequired > options.remainingSessionTokens || (requiredBudgetOmission && options.remainingSessionTokens < options.maximumResultTokens);
  const selected: AssistEnvelopeItem[] = [];
  const omitted = [...complete.omittedItems].map((entry) => ({
    contextItemVersionId: entry.contextItemVersionId,
    sourcePath: entry.sourcePath,
    reason: entry.omissionReason,
    estimatedTokens: entry.estimatedTokens,
  }));
  let delivered = 0;
  if (!resultLimitFailure && !sessionLimitFailure) {
    for (const entry of ordered) {
      if (delivered + entry.item.estimatedTokens <= options.maximumResultTokens) {
        selected.push(entry.item);
        delivered += entry.item.estimatedTokens;
      } else {
        omitted.push({
          contextItemVersionId: entry.item.contextItemVersionId,
          sourcePath: entry.item.sourcePath,
          reason: "result_token_limit",
          estimatedTokens: entry.item.estimatedTokens,
        });
      }
    }
  } else {
    for (const entry of ordered) {
      omitted.push({
        contextItemVersionId: entry.item.contextItemVersionId,
        sourcePath: entry.item.sourcePath,
        reason: sessionLimitFailure ? "session_token_limit" : "result_token_limit",
        estimatedTokens: entry.item.estimatedTokens,
      });
    }
  }
  const failureCode = sessionLimitFailure
    ? "SESSION_TOKEN_LIMIT"
    : resultLimitFailure
      ? "RESULT_TOKEN_LIMIT"
      : null;
  const success = failureCode === null;
  const selectedNew = selected.filter((item) => newIds.has(item.contextItemVersionId));
  const selectedRestored = selected.filter((item) => !newIds.has(item.contextItemVersionId));
  const omittedTokens = omitted.reduce((total, item) => total + item.estimatedTokens, 0);
  return {
    schemaVersion: ASSIST_TOOL_RESULT_SCHEMA_VERSION,
    success,
    sessionId: packet.sessionId,
    deliveryId: success ? packet.id : null,
    newItems: selectedNew,
    restoredItems: selectedRestored,
    references: complete.references,
    omittedItems: omitted,
    coverageAdded: [...packet.coverageAdded].sort(),
    coverageRemaining: [...packet.coverageRemaining].sort(),
    estimatedNewTokens: selectedNew.reduce((total, item) => total + item.estimatedTokens, 0),
    estimatedRestoredTokens: selectedRestored.reduce((total, item) => total + item.estimatedTokens, 0),
    estimatedDuplicateTokensAvoided: packet.estimatedDuplicateTokensAvoided,
    toolCallsUsed: options.toolCallsUsed,
    remainingToolCalls: Math.max(0, options.maximumToolCalls - options.toolCallsUsed),
    sessionEstimatedTokensUsed: options.sessionEstimatedTokensUsed,
    remainingEstimatedTokens: Math.max(0, options.remainingSessionTokens - delivered),
    incomplete: packet.incomplete || omittedTokens > 0 || !success,
    additionalEstimatedTokensRequired:
      packet.additionalEstimatedTokensRequired ?? (omittedTokens > 0 ? omittedTokens : null),
    limitReached: !success || omittedTokens > 0,
    failureCode,
    failureMessage:
      failureCode === "SESSION_TOKEN_LIMIT"
        ? "The requested context exceeds the remaining session budget."
        : failureCode === "RESULT_TOKEN_LIMIT"
          ? "The requested context exceeds the configured result budget."
          : null,
  };
}

export function serializeAssistContextToolResult(result: AssistContextToolResult): string {
  // Reuse the canonical recursive key ordering used by assist envelopes.
  return serializeCanonical(result);
}

const resultKeys = [
  "schemaVersion","success","sessionId","deliveryId","newItems","restoredItems","references","omittedItems",
  "coverageAdded","coverageRemaining","estimatedNewTokens","estimatedRestoredTokens","estimatedDuplicateTokensAvoided",
  "toolCallsUsed","remainingToolCalls","sessionEstimatedTokensUsed","remainingEstimatedTokens","incomplete",
  "additionalEstimatedTokensRequired","limitReached","failureCode","failureMessage",
] as const;
const strictKeys=(record:Record<string,unknown>,keys:readonly string[]):boolean=>Object.keys(record).length===keys.length&&keys.every((key)=>Object.prototype.hasOwnProperty.call(record,key));
const nonnegativeInteger=(value:unknown):value is number=>typeof value==="number"&&Number.isInteger(value)&&value>=0;
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every((entry)=>typeof entry==="string");

export function parseAssistContextToolResult(serialized:string):AssistContextToolResult {
  const value:unknown=JSON.parse(serialized);
  if(!isRecord(value)||!strictKeys(value,resultKeys)||value["schemaVersion"]!==ASSIST_TOOL_RESULT_SCHEMA_VERSION||typeof value["success"]!=="boolean"||typeof value["sessionId"]!=="string"||value["sessionId"].length===0||(value["deliveryId"]!==null&&typeof value["deliveryId"]!=="string"))throw new Error("Invalid Continuum assist tool result.");
  if(!Array.isArray(value["newItems"])||!value["newItems"].every(itemValid)||!Array.isArray(value["restoredItems"])||!value["restoredItems"].every(itemValid)||!Array.isArray(value["references"])||!value["references"].every(referenceValid))throw new Error("Invalid Continuum assist tool result.");
  if(!Array.isArray(value["omittedItems"])||!value["omittedItems"].every((entry)=>isRecord(entry)&&strictKeys(entry,["contextItemVersionId","sourcePath","reason","estimatedTokens"])&&(entry["contextItemVersionId"]===null||typeof entry["contextItemVersionId"]==="string")&&(entry["sourcePath"]===null||typeof entry["sourcePath"]==="string")&&typeof entry["reason"]==="string"&&!("content" in entry)&&nonnegativeInteger(entry["estimatedTokens"])))throw new Error("Invalid Continuum assist tool result.");
  if(!strings(value["coverageAdded"])||!strings(value["coverageRemaining"]))throw new Error("Invalid Continuum assist tool result.");
  for(const key of ["estimatedNewTokens","estimatedRestoredTokens","estimatedDuplicateTokensAvoided","toolCallsUsed","remainingToolCalls","sessionEstimatedTokensUsed","remainingEstimatedTokens"] as const)if(!nonnegativeInteger(value[key]))throw new Error("Invalid Continuum assist tool result.");
  if(typeof value["incomplete"]!=="boolean"||(value["additionalEstimatedTokensRequired"]!==null&&!nonnegativeInteger(value["additionalEstimatedTokensRequired"]))||typeof value["limitReached"]!=="boolean"||(value["failureCode"]!==null&&typeof value["failureCode"]!=="string")||(value["failureMessage"]!==null&&typeof value["failureMessage"]!=="string"))throw new Error("Invalid Continuum assist tool result.");
  if(value["references"].some((entry)=>isRecord(entry)&&"content" in entry))throw new Error("Invalid Continuum assist tool result.");
  return value as unknown as AssistContextToolResult;
}

export function buildAssistToolFailureResult(input:{sessionId:string;failureCode:string;failureMessage:string;toolCallsUsed:number;maximumToolCalls:number;sessionEstimatedTokensUsed:number;remainingEstimatedTokens:number;}):AssistContextToolResult {
  return {schemaVersion:ASSIST_TOOL_RESULT_SCHEMA_VERSION,success:false,sessionId:input.sessionId,deliveryId:null,newItems:[],restoredItems:[],references:[],omittedItems:[],coverageAdded:[],coverageRemaining:[],estimatedNewTokens:0,estimatedRestoredTokens:0,estimatedDuplicateTokensAvoided:0,toolCallsUsed:input.toolCallsUsed,remainingToolCalls:Math.max(0,input.maximumToolCalls-input.toolCallsUsed),sessionEstimatedTokensUsed:input.sessionEstimatedTokensUsed,remainingEstimatedTokens:input.remainingEstimatedTokens,incomplete:true,additionalEstimatedTokensRequired:null,limitReached:["RESULT_TOKEN_LIMIT","SESSION_TOKEN_LIMIT","TOOL_CALL_LIMIT"].includes(input.failureCode),failureCode:input.failureCode,failureMessage:input.failureMessage};
}