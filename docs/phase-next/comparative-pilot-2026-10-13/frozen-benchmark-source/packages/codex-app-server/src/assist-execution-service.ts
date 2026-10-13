import {contextDeliveryStrategy, minimalContextManifest, measureContextDelivery, type ContextDeliveryStrategy} from "./context-delivery-strategy.js";
import { observeContextActivity } from "./context-observation.js";
import { capturePolicyFor } from "@continuum/shared";
import { resolve } from "node:path";
import { CodexExecutionRepository, RunRepository } from "@continuum/database";
import { RepositoryContextSessionService } from "@continuum/context-engine";
import { resolveSnapshotIdentity } from "@continuum/git-analyzer";
import type { ContextSessionResult, DeltaContextPacket, IndexSnapshotIdentity } from "@continuum/shared";
import { StdioCodexAppServerClient } from "./client.js";
import { compatibilityFor, detectCodexVersion, resolveCodexExecutable } from "./compatibility.js";
import { CodexIntegrationError } from "./errors.js";
import { isRecord, type JsonRecord } from "./json.js";
import { normalizeCodexMessage } from "./normalizer.js";
import type { CodexRawMessage, CodexServerRequestContext, CodexThreadOptions } from "./protocol.js";
import { buildShadowReport, type ShadowFlightRecorderReport } from "./report.js";
import { openCodexDatabase, type CodexShadowOptions, type CodexShadowResult } from "./execution-service.js";
import { buildContextEnvelope } from "./assist-context-envelope.js";
import { AssistToolRouter } from "./assist-tool-router.js";
import { withContinuumCompactionPrompt } from "./compaction-policy.js";

export interface DurableAssistOptions extends Omit<CodexShadowOptions,"mode"> {
  durableMemory?:boolean; resumeSessionId?:string; reasoningEffort?:string;
  persistentSession?:boolean; contextEnabled?:boolean; nativeCompactionPrompt?:boolean;
  maximumReportedTokens?:number;
  configOverrides?:Record<string,unknown>;
  supersedesMemoryId?:string;
  contextStrategy?:ContextDeliveryStrategy;
  onContextDelivery?:(receipt:ReturnType<typeof measureContextDelivery>&{status:"prepared"|"acknowledged";executionId:string;threadId:string;turnId?:string;snapshot:IndexSnapshotIdentity;memoryVersion:number;maximumEstimatedTokens:number;incomplete:boolean;coverageRemaining:DeltaContextPacket["coverageRemaining"];sessionPreparationMs:number;recoveryCheckpointDurationMs:number|null})=>Promise<void>|void;
}

const value=(record:JsonRecord,key:string):string|null=>typeof record[key]==="string"?record[key] as string:null;

function ids(message:CodexRawMessage):{threadId:string|null;turnId:string|null;itemId:string|null}{
  const parsed=isRecord(message.parsed)?message.parsed:{};const params=isRecord(parsed.params)?parsed.params:{};const item=isRecord(params.item)?params.item:{};const turn=isRecord(params.turn)?params.turn:{};
  return{threadId:value(params,"threadId"),turnId:value(params,"turnId")??value(turn,"id"),itemId:value(params,"itemId")??value(item,"id")};
}

export class CodexAssistExecutionService {
  async runAssist(options: DurableAssistOptions): Promise<CodexShadowResult> {
    const persistent=options.durableMemory||options.persistentSession;
    if(persistent&&(!options.model||options.reasoningEffort!=="low"))throw new Error("Persistent execution requires an explicit model and low reasoning; no model substitution is allowed.");
    if(options.resumeSessionId&&!persistent)throw new Error("Resume requires a persistent session.");
    const sessions = await RepositoryContextSessionService.open(options.cwd, options.repository);
    let db = null;
    let client: StdioCodexAppServerClient | null = null;
    let executionId = "";
    let sessionId = "";
    let runId = "";
    try {
      const strategy=contextDeliveryStrategy(sessions.repositoryRoot,options.contextStrategy);
      if(strategy!=="initial_packet"&&options.contextEnabled===false)throw new Error("Retrieval delivery strategies require context tools to remain enabled.");
      const sessionPreparationStartedAt=Date.now();
      const started = options.resumeSessionId ? {session:(await sessions.status(options.resumeSessionId)).session,initialContext:undefined} : await sessions.start({ task: options.task, createInitialContext: options.contextEnabled!==false&&strategy==="initial_packet", maximumEstimatedTokens: 8000 });
      sessionId = started.session.id;
      if(options.resumeSessionId)started.session=await sessions.refresh(sessionId);
      const sessionPreparationMs=Date.now()-sessionPreparationStartedAt;
      const opened = await openCodexDatabase(options.cwd, options.repository);
      db = opened.db;
      const executions = new CodexExecutionRepository(db, capturePolicyFor(sessions.repositoryRoot));
      const executable = options.process?.executable ?? resolveCodexExecutable();
      const version = options.codexVersionOverride ?? (options.process?.executable ? "fixture" : detectCodexVersion(executable));
      const compatibility = version === "fixture" ? { tested: true, warning: null } : compatibilityFor(version);
      runId = crypto.randomUUID();
      new RunRepository(db).create({ id: runId, repositoryId: sessions.repository.id, agentId: "codex-assist", agentVersion: version, task: options.task, startingCommit: started.session.snapshot.base_commit_hash });
      await sessions.linkRun(sessionId, runId);
      if(options.durableMemory&&options.resumeSessionId){
        const old=options.supersedesMemoryId?sessions.memory.state(sessionId).entries.find(entry=>entry.id===options.supersedesMemoryId):undefined;
        if(options.supersedesMemoryId&&!old)throw new Error("Correction target not found in this session.");
        sessions.memory.write(sessionId,{kind:old?.kind??"requirement",text:options.task,authority:"user",critical:true,supersedes:options.supersedesMemoryId,operationKey:"continuation:"+runId});
      }
      executionId = crypto.randomUUID();
      
      executions.create({
        id: executionId, session_id: sessionId, repository_id: sessions.repository.id, run_id: runId,
        task_text: options.task, codex_version: version, model: options.model ?? null, mode: "assist",
        approval_configuration: options.approvalPolicy ?? "on-request", sandbox_configuration: options.sandbox ?? "workspace-write",
        base_commit_hash: started.session.snapshot.base_commit_hash, worktree_hash: started.session.snapshot.worktree_hash
      });
      
      let completionResolve: (value: { status: string; params: unknown }) => void = () => undefined;
      let completionReject: (error: Error) => void = () => undefined;
      const completion = new Promise<{ status: string; params: unknown }>((resolvePromise, rejectPromise) => {
        completionResolve = resolvePromise; completionReject = rejectPromise;
      });
      void completion.catch(()=>undefined); // Startup failures can occur before the completion wait.
      
      const recordRaw = async (message: CodexRawMessage): Promise<void> => {
        const identity = ids(message);
        const normalized = message.direction === "server_to_client" || message.direction === "server_stderr" ? normalizeCodexMessage(message) : { normalized: [], threadId: identity.threadId, turnId: identity.turnId, itemId: identity.itemId };
        executions.recordReceived({
          raw: { execution_id: executionId, direction: message.direction, message_category: message.category, method: message.method, request_id: message.requestId === null ? null : String(message.requestId), thread_id: identity.threadId, turn_id: identity.turnId, item_id: identity.itemId, timestamp: message.timestamp, raw_json: message.raw },
          normalized: normalized.normalized, ...(normalized.usage ? { usage: normalized.usage } : {}), ...(normalized.diff ? { diff: normalized.diff } : {})
        });
        // Persist provider usage before an external safety observer can stop the run.
        await options.process?.onRawMessage?.(message);
      };
      
      const rememberSources=async(packet:DeltaContextPacket)=>{
        if(!options.durableMemory)return;
        const snapshot=await resolveSnapshotIdentity(sessions.repositoryRoot);
        for(const entry of [...packet.newItems,...packet.restoredItems]){
          const item=entry.candidate.item;
          const superseded=strategy==="adaptive"?sessions.memory.state(sessionId).entries.filter(e=>e.kind==="source"&&!e.supersededBy).find(e=>{
            const old=sessions.memory.state(sessionId).evidence.find(v=>v.id===e.evidenceId)?.sourceVersionId;
            if(!old||old===item.id)return false;
            return !!db!.prepare("SELECT 1 FROM context_item_versions old JOIN context_item_versions next ON old.context_item_id=next.context_item_id WHERE old.id=? AND next.id=?").get(old,item.id);
          }):undefined;
          sessions.memory.write(sessionId,{kind:"source",text:`Source ${item.source_path} (${item.symbol_name??"document"})`,authority:"observed",snapshot,sourceVersionId:item.id,supersedes:superseded?.id,operationKey:"source-version:"+item.id});
        }
      };
      if(started.initialContext)await rememberSources(started.initialContext);
      const assistRouter = new AssistToolRouter(async (query) => {
        const packet = await sessions.request(sessionId, { query });
        await rememberSources(packet);
        return buildContextEnvelope(packet);
      });
      
      const approval = async (request: CodexServerRequestContext): Promise<unknown> => {
        if(options.durableMemory&&request.method==="item/tool/call"&&isRecord(request.params)){
          const tool=request.params["tool"],args=isRecord(request.params["arguments"])?request.params["arguments"]:{};
          if(tool==="continuum_retrieve_task_evidence"){
            if(typeof args["query"]!=="string")return{success:false,contentItems:[{type:"inputText",text:"Missing evidence query."}]};
            const result=await sessions.memory.retrieve(sessionId,args["query"]);
            return{success:result.found&&!result.incomplete,contentItems:[{type:"inputText",text:result.renderedContent||JSON.stringify({found:result.found,incomplete:result.incomplete,omittedIds:result.omittedIds})}]};
          }
          if(tool==="continuum_record_task_memory"){
            const allowed=["decision","completed","pending","question","failure","next_action"];
            if(typeof args["kind"]!=="string"||!allowed.includes(args["kind"])||typeof args["text"]!=="string")return{success:false,contentItems:[{type:"inputText",text:"Invalid agent memory."}]};
            const entry=sessions.memory.write(sessionId,{kind:args["kind"] as "decision",text:args["text"],authority:"agent_reported"});
            return{success:true,contentItems:[{type:"inputText",text:JSON.stringify({id:entry.id,evidenceId:entry.evidenceId,authority:entry.authority})}]};
          }
        }
        const assistResponse = await assistRouter.handleRequest(request);
        if (assistResponse) {
          executions.recordAssistToolCall(
            executionId, 
            "continuum_request_context", 
            JSON.stringify(isRecord(request.params) ? request.params["arguments"] ?? {} : {}), 
            assistResponse.success, 
            JSON.stringify(assistResponse.contentItems)
          );
          executions.recordAssistInjection(
            executionId, 
            sessionId, 
            injectionSequence++, 
            Buffer.byteLength(JSON.stringify(assistResponse.contentItems), "utf8"), 
            "tool"
          );
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
        requestTimeoutMs:Math.min(options.process?.requestTimeoutMs??30000,options.timeoutMs??300000),
        cwd: opened.root, onRawMessage: recordRaw, onServerRequest: approval, onFatalError: (error) => completionReject(error),
        onNotification: async (method, params) => {
          await options.process?.onNotification?.(method,params);
          if(options.maximumReportedTokens&&method==="thread/tokenUsage/updated"&&isRecord(params)&&isRecord(params["tokenUsage"])&&isRecord(params["tokenUsage"]["total"])){
            const total=params["tokenUsage"]["total"]["totalTokens"];
            if(typeof total==="number"&&total>=options.maximumReportedTokens)completionReject(new Error("Reported token ceiling reached; stopping this execution."));
          }
          await observeContextActivity(sessions,sessionId,method,params,executionId);
          if(strategy==="adaptive"&&method==="item/completed"&&isRecord(params)&&isRecord(params.item)&&params.item.type==="commandExecution"&&typeof params.item.exitCode==="number"&&params.item.exitCode!==0&&typeof params.item.command==="string"&&/\b(test|pytest|vitest|jest)\b/.test(params.item.command)) {
            const output=typeof params.item["aggregatedOutput"]==="string"?params.item["aggregatedOutput"]:"";
            const paths=[...new Set(output.match(/\b(?:src|lib|packages|tests)\/[A-Za-z0-9_./-]+\.(?:ts|js|mjs|sql)\b/g)??[])].slice(0,3);
            sessions.memory.write(sessionId,{kind:"pending",text:"Adaptive policy: observed failed test; targeted context is queued for the next continuation boundary.",authority:"observed",operationKey:"adaptive-event:"+executionId+":"+String(params.item.id),metadata:{testCommand:params.item.command,adaptiveQuery:paths.length?paths.join(" "):options.task.slice(0,300),sourceMethod:method,itemId:params.item.id}});
          }
          if(strategy==="adaptive"&&method==="item/completed"&&isRecord(params)&&isRecord(params.item)&&params.item.type==="commandExecution"&&params.item.exitCode===0&&typeof params.item.command==="string"&&/\b(test|pytest|vitest|jest)\b/.test(params.item.command)) {
            const state=sessions.memory.state(sessionId),command=params.item.command;
            for(const entry of state.entries.filter(e=>e.kind==="pending"&&!e.supersededBy&&state.evidence.find(item=>item.id===e.evidenceId)?.metadata["adaptiveQuery"]&&state.evidence.find(item=>item.id===e.evidenceId)?.metadata["testCommand"]===command))sessions.memory.write(sessionId,{kind:"pending",text:"Adaptive signal resolved by a later observed passing test; no targeted injection queued.",authority:"observed",supersedes:entry.id,operationKey:"adaptive-resolved:"+entry.id});
          }
          if(options.durableMemory&&method==="item/started"&&isRecord(params)&&isRecord(params.item)&&params.item.type==="contextCompaction")await sessions.memory.checkpoint(sessionId,"before-compaction:"+String(params.item.id));
          const compaction=method==="thread/compacted"||(method==="item/completed"&&isRecord(params)&&isRecord(params.item)&&params.item.type==="contextCompaction");
          if (compaction) {
            await sessions.checkpoint(sessionId);
            if(options.durableMemory){const identity=isRecord(params)&&isRecord(params.item)?String(params.item.id):isRecord(params)?String(params["turnId"]??"legacy"):"legacy";await sessions.memory.checkpoint(sessionId,"compaction:"+identity);}
          } else if (method === "turn/completed") {
            const turn = isRecord(params) && isRecord(params.turn) ? params.turn : {}; completionResolve({ status: String(turn.status ?? "completed"), params });
          } else if (method === "process/exited" && !(isRecord(params) && params.expected === true)) {
            completionReject(new CodexIntegrationError("UNEXPECTED_PROCESS_EXIT", "Codex App Server exited before turn completion."));
          }
        }
      });
      await client.initialize({ experimentalApi: true });
      const account = await client.readAccount();
      if (!account.authenticated && account.requiresOpenaiAuth) throw new CodexIntegrationError("AUTHENTICATION_REQUIRED", "Codex authentication is required. Run 'codex login' using the normal Codex CLI, then retry.");
      const threadOptions:CodexThreadOptions = {
        cwd: opened.root, model: options.model, approvalPolicy: options.approvalPolicy ?? "on-request", sandbox: options.sandbox ?? "workspace-write",
        reasoningEffort:options.reasoningEffort,
        configOverrides:options.configOverrides,
        autoCompaction: options.nativeCompactionPrompt||options.durableMemory?options.autoCompaction:withContinuumCompactionPrompt(options.autoCompaction, await sessions.recover(sessionId)),
        dynamicTools: options.contextEnabled===false?[]:[{
          name: "continuum_request_context",
          description: "Request additional context packets from the repository using lexical search, path matching, and symbol resolution.",
          inputSchema: { type: "object", properties: { query: { type: "string", description: "The natural language query, path, or symbol to search for." } }, required: ["query"] }
        },...(options.durableMemory?[{name:"continuum_retrieve_task_evidence",description:"Retrieve original requirements, historical decisions, failures or evidence by ID, kind or text fragment.",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}},{name:"continuum_record_task_memory",description:"Record agent-reported progress, decisions and next action; never verified test proof.",inputSchema:{type:"object",properties:{kind:{type:"string",enum:["decision","completed","pending","question","failure","next_action"]},text:{type:"string"}},required:["kind","text"]}}]:[])]
      };
      const bindingConfiguration=JSON.stringify({contextEnabled:options.contextEnabled!==false,durableMemory:!!options.durableMemory,nativeCompactionPrompt:!!(options.nativeCompactionPrompt||options.durableMemory),configOverrides:options.configOverrides??{},...(strategy!=="initial_packet"?{contextStrategy:strategy}:{})});
      const binding=db.prepare("SELECT * FROM codex_session_bindings WHERE session_id=?").get(sessionId) as {thread_id:string;model:string;reasoning_effort:string;approval_policy:string;sandbox:string;configuration_json:string}|undefined;
      if(options.resumeSessionId&&(!binding||binding.model!==options.model||binding.reasoning_effort!==options.reasoningEffort||binding.approval_policy!==threadOptions.approvalPolicy||binding.sandbox!==threadOptions.sandbox))throw new Error("Resume configuration differs from the persisted session binding.");
      if(binding&&binding.configuration_json!==bindingConfiguration)throw new Error("Resume tools or context configuration differs from the persisted session binding.");
      const thread = binding ? await client.resumeThread(binding.thread_id,threadOptions) : await client.startThread(threadOptions);
      if(persistent&&thread.model!==options.model)throw new Error("Codex selected a different model; refusing continuation.");
      if(persistent&&(thread.reasoningEffort!==options.reasoningEffort||thread.modelProvider!=="openai"))throw new Error("Codex effective reasoning or provider differs from the authorized configuration.");
      if(persistent&&!binding)db.prepare("INSERT INTO codex_session_bindings(session_id,thread_id,model,reasoning_effort,approval_policy,sandbox,configuration_json) VALUES(?,?,?,?,?,?,?)").run(sessionId,thread.id,options.model!,options.reasoningEffort!,threadOptions.approvalPolicy!,threadOptions.sandbox!,bindingConfiguration);
      executions.setLifecycle(executionId, { threadId: thread.id, model: thread.model, status: "running" });
      
      let adaptiveEnvelope="";
      let adaptivePacket:DeltaContextPacket|undefined;
      if(strategy==="adaptive"&&options.resumeSessionId){
        const state=sessions.memory.state(sessionId);
        const stalePaths=state.entries.filter(entry=>entry.kind==="source"&&!entry.supersededBy).map(entry=>state.evidence.find(e=>e.id===entry.evidenceId)?.sourceVersionId).filter(Boolean).map(id=>db!.prepare("SELECT source_path,staleness_status,valid_to_commit_exclusive FROM context_item_versions WHERE id=?").get(id!) as {source_path:string;staleness_status:string;valid_to_commit_exclusive:string|null}|undefined).filter(row=>row&&(row.valid_to_commit_exclusive!==null||["stale","possibly_stale"].includes(row.staleness_status))).map(row=>row!.source_path);
        const pending=state.entries.filter(entry=>entry.kind==="pending"&&!entry.supersededBy).map(entry=>({entry,evidence:state.evidence.find(e=>e.id===entry.evidenceId)})).filter(item=>typeof item.evidence?.metadata["adaptiveQuery"]==="string").at(-1);
        if(pending||stalePaths.length){const packet=await sessions.request(sessionId,{query:pending?String(pending.evidence!.metadata["adaptiveQuery"]):[...new Set(stalePaths)].slice(0,3).join(" ")});adaptivePacket=packet;await rememberSources(packet);if(packet.newItems.length||packet.restoredItems.length)adaptiveEnvelope=buildContextEnvelope(packet);if(pending)sessions.memory.write(sessionId,{kind:"pending",text:"Adaptive signal handled at continuation; subsequent context delivery is recorded separately.",authority:"observed",supersedes:pending.entry.id,operationKey:"adaptive-handled:"+pending.entry.id});}
      }
      const recoveryStartedAt=Date.now();
      const recovery=options.durableMemory?await sessions.memory.checkpoint(sessionId,"before-turn:"+executionId):null;
      const recoveryCheckpointDurationMs=options.durableMemory?Date.now()-recoveryStartedAt:null;
      if(recovery?.packet.incomplete)throw new Error("Required recovery state cannot fit; refusing substantive work.");
      const baseContextEnvelope = options.resumeSessionId||strategy==="initial_packet" ? [recovery?.packet.renderedContent??"",started.initialContext ? buildContextEnvelope(started.initialContext) : ""].filter(Boolean).join("\n\n") : strategy==="minimal_manifest" ? minimalContextManifest(options.task,sessions.memory.state(sessionId),started.session.snapshot,500,!!options.durableMemory) : "";
      const initialContextEnvelope=[baseContextEnvelope,adaptiveEnvelope].filter(Boolean).join("\n\n");
      const receipt={sessionPreparationMs,recoveryCheckpointDurationMs,...measureContextDelivery(strategy,initialContextEnvelope,[...(started.initialContext?.newItems??[]),...(adaptivePacket?.newItems??[]),...(adaptivePacket?.restoredItems??[])].map(entry=>({id:entry.candidate.item.id,path:entry.candidate.item.source_path,symbol:entry.candidate.item.symbol_name})),[...(started.initialContext?.omittedItems??[]),...(adaptivePacket?.omittedItems??[])]),snapshot:started.session.snapshot,memoryVersion:sessions.memory.state(sessionId).version,maximumEstimatedTokens:4000,incomplete:(started.initialContext?.incomplete??false)||(adaptivePacket?.incomplete??false),coverageRemaining:[...(started.initialContext?.coverageRemaining??[]),...(adaptivePacket?.coverageRemaining??[])]};
      if(receipt.estimatedTokens>4000)throw new Error("Incomplete context delivery: rendered content exceeds 4000 estimated tokens.");
      const deliveryReceipt=(status:"prepared"|"acknowledged",turnId:string|null)=>{const payload={origin:"continuum_local_measurement",...receipt,status,executionId,threadId:thread.id,turnId};executions.recordReceived({raw:{execution_id:executionId,direction:"server_stderr",message_category:"stderr",method:"continuum/context-delivery",request_id:null,thread_id:thread.id,turn_id:turnId,item_id:null,timestamp:new Date().toISOString(),raw_json:JSON.stringify(payload)},normalized:[]});};
      deliveryReceipt("prepared",null);
      await options.onContextDelivery?.({...receipt,status:"prepared",executionId,threadId:thread.id});
      let injectionSequence = 0;
      executions.recordAssistInjection(executionId, sessionId, injectionSequence++, Buffer.byteLength(initialContextEnvelope, "utf8"), "user");
      
      const generationStartedAt=Date.now();
      const turn = await client.startTurn({
        threadId: thread.id,
        reasoningEffort:options.reasoningEffort,
        inputs: [
          { type: "text", text: options.task, text_elements: [] },
          ...(initialContextEnvelope?[{ type: "text" as const, text: initialContextEnvelope, text_elements: [] as [] }]:[])
        ],
        model: options.model 
      });
      executions.setLifecycle(executionId, { turnId: turn.id, status: "running" });
      deliveryReceipt("acknowledged",turn.id);
      await options.onContextDelivery?.({...receipt,status:"acknowledged",executionId,threadId:thread.id,turnId:turn.id});
      if(recovery&&(options.resumeSessionId||strategy==="initial_packet")){db.prepare("UPDATE task_checkpoints SET status='delivered' WHERE id=?").run(recovery.id);db.prepare("UPDATE codex_session_bindings SET recovery_pending=0 WHERE session_id=?").run(sessionId);}
      
      // The acknowledgement delay consumes the generation budget too.
      const timeoutMs = Math.max(1,(options.timeoutMs ?? 300_000)-(Date.now()-generationStartedAt));
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, rejectPromise) => { timer = setTimeout(() => rejectPromise(new CodexIntegrationError("REQUEST_TIMEOUT", "Codex turn timed out.")), timeoutMs); });
      let completed: { status: string; params: unknown };
      try { completed = await Promise.race([completion, timeout]); } catch (error) { await client.interruptTurn(thread.id, turn.id).catch(() => undefined); throw error; } finally { if (timer) clearTimeout(timer); }
      
      const finalStatus = completed.status === "completed" ? "completed" : completed.status === "interrupted" ? "interrupted" : "failed";
      const sessionResult: ContextSessionResult = { status: finalStatus === "completed" ? "completed" : finalStatus === "interrupted" ? "cancelled" : "failed" };
      if(options.durableMemory)await sessions.memory.checkpoint(sessionId,"after-turn:"+executionId);
      else if(!persistent)await sessions.complete(sessionId, sessionResult);
      await client.close(); client = null;
      const finalSnapshot = await resolveSnapshotIdentity(opened.root); executions.finish(executionId, finalStatus, finalSnapshot); new RunRepository(db).finish({ id: runId, status: finalStatus === "completed" ? "completed" : "failed", endingCommit: finalSnapshot.base_commit_hash, exitCode: 0 });
      return { executionId, sessionId, report: buildShadowReport(opened.db, executionId, opened.root), compatibilityWarning: compatibility.warning, authenticationMode: account.mode };
    } catch (error) {
      if (client) await client.close().catch(() => undefined);
      if (db && executionId) {
        const executions = new CodexExecutionRepository(db, capturePolicyFor(sessions.repositoryRoot));
        const integration = error instanceof CodexIntegrationError ? error : new CodexIntegrationError("TURN_FAILURE", error instanceof Error ? error.message : String(error));
        let finalSnapshot: { base_commit_hash: string; worktree_hash: string | null };
        try { finalSnapshot = await resolveSnapshotIdentity(sessions.repositoryRoot); } catch {
          const sessionRow = db.prepare("SELECT base_commit_hash,worktree_hash FROM context_sessions WHERE id=?").get(sessionId) as { base_commit_hash: string; worktree_hash: string | null } | undefined;
          finalSnapshot = { base_commit_hash: sessionRow?.base_commit_hash ?? "SNAPSHOT_UNAVAILABLE", worktree_hash: sessionRow?.worktree_hash ?? null };
        }
        executions.finish(executionId, "failed", finalSnapshot, { code: integration.code, message: integration.message });
        if (runId) new RunRepository(db).finish({ id: runId, status: "failed", endingCommit: finalSnapshot.base_commit_hash, exitCode: 1, errorSummary: integration.message });
      }
      if (sessionId) {
        if(options.durableMemory)await sessions.memory.checkpoint(sessionId,"interrupted:"+(executionId||runId)).catch(()=>undefined);
        else if(!persistent)await sessions.complete(sessionId, { status: "failed" }).catch(() => undefined);
      }
      throw error;
    } finally { db?.close(); sessions.close(); }
  }
}
