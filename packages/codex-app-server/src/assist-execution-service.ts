import { resolve } from "node:path";
import { CodexExecutionRepository } from "@continuum/database";
import { RepositoryContextSessionService } from "@continuum/context-engine";
import { resolveSnapshotIdentity } from "@continuum/git-analyzer";
import type { ContextSessionResult } from "@continuum/shared";
import { StdioCodexAppServerClient } from "./client.js";
import { compatibilityFor, detectCodexVersion, resolveCodexExecutable } from "./compatibility.js";
import { CodexIntegrationError } from "./errors.js";
import { isRecord, type JsonRecord } from "./json.js";
import { normalizeCodexMessage } from "./normalizer.js";
import type { CodexRawMessage, CodexServerRequestContext } from "./protocol.js";
import { buildShadowReport, type ShadowFlightRecorderReport } from "./report.js";
import { openCodexDatabase, type CodexShadowOptions, type CodexShadowResult } from "./execution-service.js";
import { buildContextEnvelope } from "./assist-context-envelope.js";
import { AssistToolRouter } from "./assist-tool-router.js";

const value=(record:JsonRecord,key:string):string|null=>typeof record[key]==="string"?record[key] as string:null;

function ids(message:CodexRawMessage):{threadId:string|null;turnId:string|null;itemId:string|null}{
  const parsed=isRecord(message.parsed)?message.parsed:{};const params=isRecord(parsed.params)?parsed.params:{};const item=isRecord(params.item)?params.item:{};const turn=isRecord(params.turn)?params.turn:{};
  return{threadId:value(params,"threadId"),turnId:value(params,"turnId")??value(turn,"id"),itemId:value(params,"itemId")??value(item,"id")};
}

export class CodexAssistExecutionService {
  async runAssist(options: Omit<CodexShadowOptions, "mode">): Promise<CodexShadowResult> {
    const sessions = await RepositoryContextSessionService.open(options.cwd, options.repository);
    let db = null;
    let client: StdioCodexAppServerClient | null = null;
    let executionId = "";
    let sessionId = "";
    try {
      const started = await sessions.start({ task: options.task, createInitialContext: true, maximumEstimatedTokens: 8000 });
      sessionId = started.session.id;
      const opened = await openCodexDatabase(options.cwd, options.repository);
      db = opened.db;
      const executions = new CodexExecutionRepository(db);
      const executable = options.process?.executable ?? resolveCodexExecutable();
      const version = options.codexVersionOverride ?? (options.process?.executable ? "fixture" : detectCodexVersion(executable));
      const compatibility = version === "fixture" ? { tested: true, warning: null } : compatibilityFor(version);
      executionId = crypto.randomUUID();
      
      executions.create({
        id: executionId, session_id: sessionId, repository_id: sessions.repository.id, run_id: started.session.runId ?? null,
        task_text: options.task, codex_version: version, model: options.model ?? null, mode: "assist",
        approval_configuration: options.approvalPolicy ?? "on-request", sandbox_configuration: options.sandbox ?? "workspace-write",
        base_commit_hash: started.session.snapshot.base_commit_hash, worktree_hash: started.session.snapshot.worktree_hash
      });
      
      let completionResolve: (value: { status: string; params: unknown }) => void = () => undefined;
      let completionReject: (error: Error) => void = () => undefined;
      const completion = new Promise<{ status: string; params: unknown }>((resolvePromise, rejectPromise) => {
        completionResolve = resolvePromise; completionReject = rejectPromise;
      });
      
      const recordRaw = async (message: CodexRawMessage): Promise<void> => {
        const identity = ids(message);
        const normalized = message.direction === "server_to_client" || message.direction === "server_stderr" ? normalizeCodexMessage(message) : { normalized: [], threadId: identity.threadId, turnId: identity.turnId, itemId: identity.itemId };
        executions.recordReceived({
          raw: { execution_id: executionId, direction: message.direction, message_category: message.category, method: message.method, request_id: message.requestId === null ? null : String(message.requestId), thread_id: identity.threadId, turn_id: identity.turnId, item_id: identity.itemId, timestamp: message.timestamp, raw_json: message.raw },
          normalized: normalized.normalized, ...(normalized.usage ? { usage: normalized.usage } : {}), ...(normalized.diff ? { diff: normalized.diff } : {})
        });
      };
      
      const assistRouter = new AssistToolRouter(async (query) => {
        const packet = await sessions.request(sessionId, { query });
        return buildContextEnvelope(packet);
      });
      
      const approval = async (request: CodexServerRequestContext): Promise<unknown> => {
        const assistResponse = await assistRouter.handleRequest(request);
        if (assistResponse) {
          executions.recordReceived({
            raw: { execution_id: executionId, direction: "client_to_server", message_category: "notification", method: "continuum/approvalDecision", request_id: String(request.id), thread_id: isRecord(request.params) ? value(request.params, "threadId") : null, turn_id: isRecord(request.params) ? value(request.params, "turnId") : null, item_id: isRecord(request.params) ? value(request.params, "itemId") : null, timestamp: new Date().toISOString(), raw_json: JSON.stringify(assistResponse) },
            normalized: [{ eventType: "approval_decision", evidenceType: "directly observed", confidence: "high", payload: { requestMethod: request.method, decision: assistResponse.decision } }]
          });
          return assistResponse;
        }
        const decision = options.approvalHandler ? await options.approvalHandler(request) : "decline";
        executions.recordReceived({
          raw: { execution_id: executionId, direction: "client_to_server", message_category: "notification", method: "continuum/approvalDecision", request_id: String(request.id), thread_id: isRecord(request.params) ? value(request.params, "threadId") : null, turn_id: isRecord(request.params) ? value(request.params, "turnId") : null, item_id: isRecord(request.params) ? value(request.params, "itemId") : null, timestamp: new Date().toISOString(), raw_json: JSON.stringify({ decision }) },
          normalized: [{ eventType: "approval_decision", evidenceType: "directly observed", confidence: "high", payload: { requestMethod: request.method, decision } }]
        });
        return { decision };
      };
      
      client = new StdioCodexAppServerClient();
      await client.start({
        ...options.process, ...(options.process?.executable ? { executable: options.process.executable } : {}),
        cwd: opened.root, onRawMessage: recordRaw, onServerRequest: approval, onFatalError: (error) => completionReject(error),
        onNotification: async (method, params) => {
          if (method === "turn/completed") {
            const turn = isRecord(params) && isRecord(params.turn) ? params.turn : {}; completionResolve({ status: String(turn.status ?? "completed"), params });
          } else if (method === "process/exited" && !(isRecord(params) && params.expected === true)) {
            completionReject(new CodexIntegrationError("UNEXPECTED_PROCESS_EXIT", "Codex App Server exited before turn completion."));
          }
        }
      });
      await client.initialize({ experimentalApi: options.experimentalRawUsage === true });
      const account = await client.readAccount();
      if (!account.authenticated && account.requiresOpenaiAuth) throw new CodexIntegrationError("AUTHENTICATION_REQUIRED", "Codex authentication is required. Run 'codex login' using the normal Codex CLI, then retry.");
      
      const thread = await client.startThread({ cwd: opened.root, model: options.model, approvalPolicy: options.approvalPolicy ?? "on-request", sandbox: options.sandbox ?? "workspace-write" });
      executions.setLifecycle(executionId, { threadId: thread.id, model: thread.model, status: "running" });
      
      const initialContextEnvelope = started.initialContext ? buildContextEnvelope(started.initialContext) : "";
      const assistInstructions = `\n\nTo search the codebase, you have access to a progressive context engine. Run the command \`continuum_context search <query>\` to retrieve relevant code snippets.`;
      const prompt = `${options.task}\n\n${initialContextEnvelope}${assistInstructions}`;
      
      const turn = await client.startTurn({ threadId: thread.id, task: prompt, model: options.model });
      executions.setLifecycle(executionId, { turnId: turn.id, status: "running" });
      
      const timeoutMs = options.timeoutMs ?? 300_000;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, rejectPromise) => { timer = setTimeout(() => rejectPromise(new CodexIntegrationError("REQUEST_TIMEOUT", "Codex turn timed out.")), timeoutMs); });
      let completed: { status: string; params: unknown };
      try { completed = await Promise.race([completion, timeout]); } catch (error) { await client.interruptTurn(thread.id, turn.id).catch(() => undefined); throw error; } finally { if (timer) clearTimeout(timer); }
      
      const finalStatus = completed.status === "completed" ? "completed" : completed.status === "interrupted" ? "interrupted" : "failed";
      const sessionResult: ContextSessionResult = { status: finalStatus === "completed" ? "completed" : finalStatus === "interrupted" ? "cancelled" : "failed" };
      await sessions.complete(sessionId, sessionResult);
      await client.close(); client = null;
      const finalSnapshot = await resolveSnapshotIdentity(opened.root); executions.finish(executionId, finalStatus, finalSnapshot);
      return { executionId, sessionId, report: buildShadowReport(opened.db, executionId, opened.root), compatibilityWarning: compatibility.warning, authenticationMode: account.mode };
    } catch (error) {
      if (client) await client.close().catch(() => undefined);
      if (db && executionId) {
        const executions = new CodexExecutionRepository(db);
        const integration = error instanceof CodexIntegrationError ? error : new CodexIntegrationError("TURN_FAILURE", error instanceof Error ? error.message : String(error));
        let finalSnapshot: { base_commit_hash: string; worktree_hash: string | null };
        try { finalSnapshot = await resolveSnapshotIdentity(sessions.repositoryRoot); } catch {
          const sessionRow = db.prepare("SELECT base_commit_hash,worktree_hash FROM context_sessions WHERE id=?").get(sessionId) as { base_commit_hash: string; worktree_hash: string | null } | undefined;
          finalSnapshot = { base_commit_hash: sessionRow?.base_commit_hash ?? "SNAPSHOT_UNAVAILABLE", worktree_hash: sessionRow?.worktree_hash ?? null };
        }
        executions.finish(executionId, "failed", finalSnapshot, { code: integration.code, message: integration.message });
      }
      if (sessionId) await sessions.complete(sessionId, { status: "failed" }).catch(() => undefined);
      throw error;
    } finally { db?.close(); sessions.close(); }
  }
}
