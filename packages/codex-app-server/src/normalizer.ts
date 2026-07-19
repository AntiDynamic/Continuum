import { createHash } from "node:crypto";
import type { CodexNormalizedEventInput, CodexUsageInput, CodexDiffInput } from "@continuum/database";
import type { CodexRawMessage } from "./protocol.js";
import { isRecord } from "./json.js";

const text=(value:unknown):string|null=>typeof value==="string"?value:null;
const number=(value:unknown):number|null=>typeof value==="number"&&Number.isFinite(value)?value:null;

export interface NormalizedCodexMessage { normalized:CodexNormalizedEventInput[]; usage?:CodexUsageInput; diff?:CodexDiffInput; threadId:string|null; turnId:string|null; itemId:string|null }

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
    for(const path of paths)push(/\b(?:rg|grep|findstr|select-string)\b/i.test(command)?"repository_search":"file_read_evidence","command-inferred","medium",{path,command});
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
 *
 * Deterministic argument parsing for rg, grep, findstr, and select-string.
 * Does NOT use LLM or heuristic regex to extract "symbols" — only extracts
 * literal patterns and explicit path arguments as they appear in the command string.
 */
export interface ParsedRepositorySearch {
  /** The search tool detected (rg, grep, findstr, select-string, or unknown) */
  tool: "rg" | "grep" | "findstr" | "select-string" | "unknown";
  /**
   * Literal search patterns (the non-flag positional arguments to the command).
   * Only includes arguments that are not flag values (e.g. -e PATTERN is included,
   * --type ts is not). Patterns that look like valid identifiers are likely symbols.
   * Patterns are returned unquoted.
   */
  patterns: string[];
  /**
   * Explicit path arguments (positional path args, -f FILE, --include glob, etc.).
   * Only includes arguments that look like file-system paths (contain / or .).
   */
  paths: string[];
}

/**
 * Parse a shell command string for rg/grep/findstr/select-string to extract
 * literal search patterns and explicit path arguments.
 *
 * This function uses deterministic argument splitting and flag skipping.
 * It does NOT use regex to extract "symbols" from arbitrary command text.
 * If the command is not a recognised search tool, tool === "unknown" and
 * patterns/paths are empty.
 */
export function parseSearchCommand(command: string): ParsedRepositorySearch {
  const empty: ParsedRepositorySearch = { tool: "unknown", patterns: [], paths: [] };
  if (!command) return empty;

  // Detect tool
  const lower = command.toLowerCase();
  let tool: ParsedRepositorySearch["tool"] = "unknown";
  if (/\brg\b/.test(command)) tool = "rg";
  else if (/\bgrep\b/.test(lower)) tool = "grep";
  else if (/\bfindstr\b/i.test(command)) tool = "findstr";
  else if (/\bselect-string\b/i.test(command)) tool = "select-string";
  if (tool === "unknown") return empty;

  // Tokenize: split on whitespace but respect single/double quotes
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

  // Flags that consume one following argument (common for rg/grep)
  const argConsumingFlags = new Set([
    "-e", "--regexp", "-f", "--file",
    "-m", "--max-count", "--max-depth", "-A", "-B", "-C",
    "--context", "--after-context", "--before-context",
    "--type", "--type-not", "-t", "--color", "--colors",
    "--encoding", "--path-separator", "--sort", "--sortr",
    "--threads", "-j", "--iglob", "--glob", "-g",
    // grep equivalents
    "--include", "--exclude", "--exclude-dir",
    // PowerShell
    "-Pattern", "-LiteralPath", "-Path", "-Include", "-Exclude",
  ]);

  const patterns: string[] = [];
  const paths: string[] = [];

  // Skip the tool name itself
  let i = 0;
  while (i < tokens.length && !/^(?:rg|grep|findstr|select-string)$/i.test(tokens[i]!)) i++;
  i++; // skip tool token

  // Scan remaining tokens
  let expectPattern = false; // true when the next token is a -e pattern
  let patternDone = false;   // for rg/grep: first non-flag non-path after tool is the pattern
  while (i < tokens.length) {
    const tok = tokens[i]!;

    // End of options
    if (tok === "--") { i++; break; }

    // Flag argument: --flag=value
    if (tok.startsWith("--") && tok.includes("=")) {
      const flag = tok.split("=")[0]!;
      const val = tok.slice(flag.length + 1);
      if (flag === "-e" || flag === "--regexp") patterns.push(val);
      i++; continue;
    }

    // Short/long flag that consumes the next token
    if (argConsumingFlags.has(tok)) {
      const nextTok = tokens[i + 1];
      if (nextTok !== undefined) {
        if (tok === "-e" || tok === "--regexp") {
          patterns.push(nextTok);
        } else if ((tok === "-f" || tok === "--file") && nextTok.includes("/")) {
          paths.push(nextTok);
        }
        i += 2; continue;
      }
      i++; continue;
    }

    // Boolean flags (single dash or double dash without value)
    if (tok.startsWith("-")) { i++; continue; }

    // Non-flag token: first is pattern, rest are paths (for rg/grep)
    if (tool === "rg" || tool === "grep") {
      if (!patternDone) {
        patterns.push(tok);
        patternDone = true;
      } else {
        // Subsequent non-flag args are paths
        if (tok.includes("/") || tok.includes(".")) paths.push(tok);
      }
    } else if (tool === "findstr") {
      // findstr /S /I pattern file1 file2 ...
      if (!patternDone) { patterns.push(tok); patternDone = true; }
      else { if (tok.includes("/") || tok.includes(".")) paths.push(tok); }
    } else if (tool === "select-string") {
      patterns.push(tok);
    }
    i++;
  }

  // Any remaining tokens after "--" are paths
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (tok.includes("/") || tok.includes(".")) paths.push(tok);
    i++;
  }

  return {
    tool,
    patterns: [...new Set(patterns.filter(p => p.length > 0))],
    paths: [...new Set(paths.filter(p => p.length > 0))],
  };
}
