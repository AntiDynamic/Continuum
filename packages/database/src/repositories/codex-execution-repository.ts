import type { Db } from "../connection.js";
import { now } from "@continuum/shared";

export interface CodexExecutionRow {
  id: string; session_id: string; repository_id: number; run_id: string | null; task_text: string;
  codex_thread_id: string | null; codex_turn_id: string | null; codex_version: string; model: string | null;
  mode: "shadow" | "assist"; approval_configuration: string; sandbox_configuration: string; base_commit_hash: string;
  worktree_hash: string | null; final_base_commit_hash: string | null; final_worktree_hash: string | null;
  repository_changed: number; status: string; started_at: string; completed_at: string | null;
  failure_code: string | null; failure_message: string | null;
}
export interface CodexRawEventRow {
  execution_id: string; sequence_number: number; direction: string; message_category: string; method: string | null;
  request_id: string | null; thread_id: string | null; turn_id: string | null; item_id: string | null;
  timestamp: string; raw_json: string;
}
export interface CodexNormalizedEventInput {
  eventType: string; evidenceType: string; confidence: string; payload: unknown;
  threadId?: string | null; turnId?: string | null; itemId?: string | null;
}
export interface CodexUsageInput {
  source: string; inputTokens?: number | null; cachedInputTokens?: number | null; outputTokens?: number | null;
  reasoningTokens?: number | null; totalTokens?: number | null; accumulation: "accumulated" | "per_response";
  measurement: "measured" | "estimated" | "unavailable"; rawProviderPayload: unknown;
}
export interface CodexDiffInput { turnId: string | null; diff: string; contentHash: string }
export interface ReceivedCodexEvent {
  raw: Omit<CodexRawEventRow, "sequence_number">;
  normalized?: CodexNormalizedEventInput[];
  usage?: CodexUsageInput;
  diff?: CodexDiffInput;
}

export class CodexExecutionRepository {
  constructor(private readonly db: Db) {}
  create(input: Omit<CodexExecutionRow, "codex_thread_id" | "codex_turn_id" | "final_base_commit_hash" | "final_worktree_hash" | "repository_changed" | "status" | "started_at" | "completed_at" | "failure_code" | "failure_message">): CodexExecutionRow {
    const started = now();
    this.db.prepare(`INSERT INTO codex_executions(id,session_id,repository_id,run_id,task_text,codex_thread_id,codex_turn_id,codex_version,model,mode,approval_configuration,sandbox_configuration,base_commit_hash,worktree_hash,final_base_commit_hash,final_worktree_hash,repository_changed,status,started_at,completed_at,failure_code,failure_message) VALUES(?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,?,NULL,NULL,0,'starting',?,NULL,NULL,NULL)`).run(input.id,input.session_id,input.repository_id,input.run_id,input.task_text,input.codex_version,input.model,input.mode,input.approval_configuration,input.sandbox_configuration,input.base_commit_hash,input.worktree_hash,started);
    return this.findRequired(input.id);
  }
  find(id: string): CodexExecutionRow | undefined { return this.db.prepare("SELECT * FROM codex_executions WHERE id=?").get(id) as CodexExecutionRow | undefined; }
  findRequired(id: string): CodexExecutionRow { const row=this.find(id); if(!row) throw new Error(`Codex execution not found: ${id}`); return row; }
  list(repositoryId?: number, limit=20): CodexExecutionRow[] { return (repositoryId===undefined?this.db.prepare("SELECT * FROM codex_executions ORDER BY started_at DESC LIMIT ?").all(limit):this.db.prepare("SELECT * FROM codex_executions WHERE repository_id=? ORDER BY started_at DESC LIMIT ?").all(repositoryId,limit)) as unknown as CodexExecutionRow[]; }
  setLifecycle(id:string, values:{threadId?:string;turnId?:string;model?:string|null;status?:string}):void {
    const row=this.findRequired(id); this.db.prepare("UPDATE codex_executions SET codex_thread_id=?,codex_turn_id=?,model=?,status=? WHERE id=?").run(values.threadId??row.codex_thread_id,values.turnId??row.codex_turn_id,values.model===undefined?row.model:values.model,values.status??row.status,id);
  }
  finish(id:string,status:string,finalSnapshot:{base_commit_hash:string;worktree_hash:string|null},failure?:{code:string;message:string}):void {
    const start=this.findRequired(id); const changed=start.base_commit_hash!==finalSnapshot.base_commit_hash||start.worktree_hash!==finalSnapshot.worktree_hash;
    this.db.prepare("UPDATE codex_executions SET status=?,completed_at=?,failure_code=?,failure_message=?,final_base_commit_hash=?,final_worktree_hash=?,repository_changed=? WHERE id=?").run(status,now(),failure?.code??null,failure?.message??null,finalSnapshot.base_commit_hash,finalSnapshot.worktree_hash,changed?1:0,id);
  }
  recordReceived(input:ReceivedCodexEvent):number {
    this.db.exec("BEGIN");
    try {
      const sequence=((this.db.prepare("SELECT COALESCE(MAX(sequence_number),0)+1 n FROM codex_raw_events WHERE execution_id=?").get(input.raw.execution_id) as {n:number}).n);
      this.db.prepare("INSERT INTO codex_raw_events(execution_id,sequence_number,direction,message_category,method,request_id,thread_id,turn_id,item_id,timestamp,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(input.raw.execution_id,sequence,input.raw.direction,input.raw.message_category,input.raw.method,input.raw.request_id,input.raw.thread_id,input.raw.turn_id,input.raw.item_id,input.raw.timestamp,input.raw.raw_json);
      for(const event of input.normalized??[]) this.db.prepare("INSERT INTO codex_normalized_events(id,execution_id,raw_sequence_number,event_type,evidence_type,confidence,thread_id,turn_id,item_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(crypto.randomUUID(),input.raw.execution_id,sequence,event.eventType,event.evidenceType,event.confidence,event.threadId??input.raw.thread_id,event.turnId??input.raw.turn_id,event.itemId??input.raw.item_id,JSON.stringify(event.payload),input.raw.timestamp);
      if(input.usage)this.db.prepare("INSERT INTO codex_usage_snapshots(id,execution_id,raw_sequence_number,source,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,accumulation,measurement,timestamp,raw_provider_payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(crypto.randomUUID(),input.raw.execution_id,sequence,input.usage.source,input.usage.inputTokens??null,input.usage.cachedInputTokens??null,input.usage.outputTokens??null,input.usage.reasoningTokens??null,input.usage.totalTokens??null,input.usage.accumulation,input.usage.measurement,input.raw.timestamp,JSON.stringify(input.usage.rawProviderPayload));
      if(input.diff)this.db.prepare("INSERT OR IGNORE INTO codex_turn_diffs(id,execution_id,raw_sequence_number,turn_id,content_hash,diff_text,created_at) VALUES(?,?,?,?,?,?,?)").run(crypto.randomUUID(),input.raw.execution_id,sequence,input.diff.turnId,input.diff.contentHash,input.diff.diff,input.raw.timestamp);
      this.db.exec("COMMIT"); return sequence;
    } catch(error) { this.db.exec("ROLLBACK"); throw error; }
  }
  recordAssistToolCall(executionId: string, toolName: string, argumentsJson: string, success: boolean, contentItemsJson: string): void {
    this.db.prepare("INSERT INTO codex_assist_tool_call_events(id,execution_id,tool_name,arguments_json,response_success,response_content_items_json) VALUES(?,?,?,?,?,?)").run(crypto.randomUUID(),executionId,toolName,argumentsJson,success?1:0,contentItemsJson);
  }
  recordAssistInjection(executionId: string, sessionId: string, sequence: number, sizeBytes: number, role: string): void {
    this.db.prepare("INSERT INTO codex_assist_injections(id,execution_id,context_session_id,injection_sequence,envelope_size_bytes,source_role) VALUES(?,?,?,?,?,?)").run(crypto.randomUUID(),executionId,sessionId,sequence,sizeBytes,role);
  }
  listRaw(executionId:string):CodexRawEventRow[]{return this.db.prepare("SELECT * FROM codex_raw_events WHERE execution_id=? ORDER BY sequence_number").all(executionId) as unknown as CodexRawEventRow[];}
  listNormalized(executionId:string):any[]{return this.db.prepare("SELECT * FROM codex_normalized_events WHERE execution_id=? ORDER BY raw_sequence_number,rowid").all(executionId) as any[];}
  listUsage(executionId:string):any[]{return this.db.prepare("SELECT * FROM codex_usage_snapshots WHERE execution_id=? ORDER BY raw_sequence_number,rowid").all(executionId) as any[];}
  latestDiff(executionId:string):any|undefined{return this.db.prepare("SELECT * FROM codex_turn_diffs WHERE execution_id=? ORDER BY raw_sequence_number DESC LIMIT 1").get(executionId) as any;}
}
