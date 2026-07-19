import { createHash } from "node:crypto";
import type { CodexNormalizedEventInput, CodexUsageInput, CodexDiffInput } from "@continuum/database";
import type { CodexRawMessage } from "./protocol.js";
import { isRecord } from "./json.js";

const text=(value:unknown):string|null=>typeof value==="string"?value:null;
const number=(value:unknown):number|null=>typeof value==="number"&&Number.isFinite(value)?value:null;

export interface NormalizedCodexMessage { normalized:CodexNormalizedEventInput[]; usage?:CodexUsageInput; diff?:CodexDiffInput; threadId:string|null; turnId:string|null; itemId:string|null }
export interface NormalizedRepositorySearchPayload {
  command: string;
  cwd: string | null;
  searchTool: "rg" | "grep" | "git-grep" | "findstr" | "select-string";
  patterns: string[];
  searchedSymbols: string[];
  searchedPaths: string[];
}

function testFramework(command:string):string|null{
  const lower=command.toLowerCase();
  if(/\bvitest\b/.test(lower))return "vitest";if(/\bjest\b/.test(lower))return "jest";if(/\bpytest\b/.test(lower))return "pytest";
  if(/\bcargo\s+test\b/.test(lower))return "cargo";if(/\bgo\s+test\b/.test(lower))return "go";if(/\bdotnet\s+test\b/.test(lower))return "dotnet";
  if(/\bmvn\b.*\btest\b/.test(lower))return "maven";if(/\bgradle\b.*\btest\b/.test(lower))return "gradle";
  if(/\b(?:pnpm|npm|yarn)\s+(?:run\s+)?test\b/.test(lower))return lower.match(/\b(pnpm|npm|yarn)\b/)?.[1]??"javascript";
  return null;
}

function inferredPaths(command:string):string[]{
  const matches=command.match(/(?:[A-Za-z]:[\\/][^\s"']+|(?:\.\.?[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+)/g)??[];
  return [...new Set(matches.map((value)=>value.replaceAll("\\","/")))];
}

export function normalizeCodexMessage(message:CodexRawMessage):NormalizedCodexMessage{
  const parsed=isRecord(message.parsed)?message.parsed:{};const params=isRecord(parsed.params)?parsed.params:{};
  const item=isRecord(params.item)?params.item:{};const method=message.method;
  const threadId=text(params.threadId);const turnId=text(params.turnId)??(isRecord(params.turn)?text(params.turn.id):null);const itemId=text(item.id)??text(params.itemId);
  const normalized:CodexNormalizedEventInput[]=[];
  const push=(eventType:string,evidenceType:string,confidence:string,payload:unknown)=>normalized.push({eventType,evidenceType,confidence,payload,threadId,turnId,itemId});
  if(message.category==="malformed")push("error","unknown","low",{code:"MALFORMED_SERVER_MESSAGE",raw:message.raw});
  else if(message.direction==="server_stderr")push("error","unknown","low",{source:"stderr",text:message.raw});
  else if(method==="thread/started")push("thread_start","directly observed","high",params);
  else if(method==="turn/started")push("turn_start","directly observed","high",params);
  else if(method==="turn/plan/updated"||item.type==="plan")push("plan_update","directly observed","high",params);
  else if(item.type==="agentMessage")push("agent_message","directly observed","high",{text:item.text,phase:item.phase});
  else if(item.type==="commandExecution"&&(method==="item/completed"||method==="item/started")){
    const command=text(item.command)??"";const cwd=text(item.cwd);const exitCode=number(item.exitCode);const framework=testFramework(command);const paths=inferredPaths(command);
    push("command_execution","directly observed","high",{command,cwd,exitCode,durationMs:number(item.durationMs),status:item.status,source:item.source});
    
    const search = parseSearchCommand(command);
    if (search.tool !== "unknown") {
      const searchPayload: NormalizedRepositorySearchPayload = {
        command,
        cwd,
        searchTool: search.tool,
        patterns: search.patterns,
        searchedSymbols: search.searchedSymbols,
        searchedPaths: search.paths
      };
      push("repository_search", "command-inferred", "medium", searchPayload);
    } else {
      for(const path of paths) push("file_read_evidence","command-inferred","medium",{path,command});
    }

    if(framework&&method==="item/completed")push("test_execution","command-inferred","medium",{command,cwd,exitCode,durationMs:number(item.durationMs),framework,status:exitCode===0?"passed":exitCode===null?"unknown":"failed"});
  } else if(item.type==="fileChange"){
    const changes=Array.isArray(item.changes)?item.changes:[];push("file_edit","directly observed","high",{changes,status:item.status});
  } else if(method==="turn/diff/updated")push("diff_update","diff-observed","high",{diff:params.diff});
  else if(method==="thread/tokenUsage/updated")push("token_usage_update","directly observed","high",params);
  else if(method==="turn/completed")push("turn_completion","directly observed","high",params);
  else if(method==="error")push("error","directly observed","high",params);
  else if(method==="process/exited")push("process_exit","directly observed","high",params);
  else if(message.category==="server_request"&&/requestApproval$/.test(method??""))push("approval_request","directly observed","high",{method,params});
  else if(method)push("unknown_notification","unknown","low",{method,params});
  let usage:CodexUsageInput|undefined;
  if(method==="thread/tokenUsage/updated"&&isRecord(params.tokenUsage)&&isRecord(params.tokenUsage.total)){
    const total=params.tokenUsage.total;
    usage={source:"codex.thread/tokenUsage/updated",inputTokens:number(total.inputTokens),cachedInputTokens:number(total.cachedInputTokens),outputTokens:number(total.outputTokens),reasoningTokens:number(total.reasoningOutputTokens),totalTokens:number(total.totalTokens),accumulation:"accumulated",measurement:"measured",rawProviderPayload:params.tokenUsage};
  }
  let diff:CodexDiffInput|undefined;
  if(method==="turn/diff/updated"&&typeof params.diff==="string")diff={turnId,diff:params.diff,contentHash:createHash("sha256").update(params.diff).digest("hex")};
  return{normalized,...(usage?{usage}:{}),...(diff?{diff}:{}),threadId,turnId,itemId};
}

export { testFramework, inferredPaths };

/**
 * Parsed result of a repository search command.
 */
export interface ParsedRepositorySearch {
  tool: "rg" | "grep" | "git-grep" | "findstr" | "select-string" | "unknown";
  patterns: string[];
  searchedSymbols: string[];
  paths: string[];
}

const IS_SYMBOL = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

export function parseSearchCommand(command: string): ParsedRepositorySearch {
  const empty: ParsedRepositorySearch = { tool: "unknown", patterns: [], searchedSymbols: [], paths: [] };
  if (!command) return empty;

  const lower = command.toLowerCase();
  let tool: ParsedRepositorySearch["tool"] = "unknown";
  if (/\bgit\s+grep\b/.test(lower)) tool = "git-grep";
  else if (/\brg\b/.test(lower)) tool = "rg";
  else if (/\bgrep\b/.test(lower)) tool = "grep";
  else if (/\bfindstr\b/i.test(command)) tool = "findstr";
  else if (/\bselect-string\b/i.test(command)) tool = "select-string";
  if (tool === "unknown") return empty;

  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (const ch of command) {
    if (ch === "'" && !inDouble) { inSingle = !inSingle; }
    else if (ch === '"' && !inSingle) { inDouble = !inDouble; }
    else if ((ch === " " || ch === "\t") && !inSingle && !inDouble) {
      if (current) { tokens.push(current); current = ""; }
    } else { current += ch; }
  }
  if (current) tokens.push(current);

  const argConsumingFlags = new Set([
    "-e", "--regexp", "-f", "--file",
    "-m", "--max-count", "--max-depth", "-A", "-B", "-C",
    "--context", "--after-context", "--before-context",
    "--type", "--type-not", "-t", "--color", "--colors",
    "--encoding", "--path-separator", "--sort", "--sortr",
    "--threads", "-j", "--iglob", "--glob", "-g",
    "--include", "--exclude", "--exclude-dir"
  ]);

  const patterns: string[] = [];
  const paths: string[] = [];

  let i = 0;
  if (tool === "git-grep") {
    while (i < tokens.length && tokens[i] !== "grep") i++;
    i++;
  } else {
    while (i < tokens.length && !/^(?:rg|grep|findstr|select-string)$/i.test(tokens[i]!)) i++;
    i++;
  }

  let patternDone = false;
  let expectPatternNext = false;
  let expectPathNext = false;

  while (i < tokens.length) {
    const tok = tokens[i]!;

    if (tok === "--") { i++; break; }

    if (expectPatternNext) {
      patterns.push(tok);
      expectPatternNext = false;
      i++; continue;
    }
    if (expectPathNext) {
      paths.push(tok);
      expectPathNext = false;
      i++; continue;
    }

    if (tok.startsWith("--") && tok.includes("=")) {
      const flag = tok.split("=")[0]!;
      const val = tok.slice(flag.length + 1);
      if (flag === "-e" || flag === "--regexp") patterns.push(val);
      i++; continue;
    }

    if (tool === "select-string") {
      if (tok.toLowerCase() === "-pattern") { expectPatternNext = true; i++; continue; }
      if (tok.toLowerCase() === "-path" || tok.toLowerCase() === "-literalpath") { expectPathNext = true; i++; continue; }
      if (tok.startsWith("-")) { i++; continue; }
      patterns.push(tok);
      i++; continue;
    }

    if (argConsumingFlags.has(tok)) {
      if (tok === "-e" || tok === "--regexp") expectPatternNext = true;
      else if (tok === "-f" || tok === "--file") expectPathNext = true;
      else i++;
      i++; continue;
    }

    if (tok.startsWith("-") && tool !== "findstr") { i++; continue; }
    if (tool === "findstr" && tok.startsWith("/")) { i++; continue; }

    if (!patternDone) {
      patterns.push(tok);
      patternDone = true;
    } else {
      if (tool === "rg" || tool === "grep" || tool === "git-grep") {
        paths.push(tok);
      } else {
        if (tok.includes("/") || tok.includes(".") || tok.includes("\\") || tok.includes("*")) {
          paths.push(tok);
        }
      }
    }
    i++;
  }

  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (tok.includes("/") || tok.includes(".") || tok.includes("\\") || tok.includes("*")) paths.push(tok);
    i++;
  }

  const uniquePatterns = [...new Set(patterns.filter(p => p.length > 0))];
  const uniquePaths = [...new Set(paths.filter(p => p.length > 0))];
  const searchedSymbols = uniquePatterns.filter(p => IS_SYMBOL.test(p));

  return {
    tool,
    patterns: uniquePatterns,
    searchedSymbols,
    paths: uniquePaths,
  };
}
