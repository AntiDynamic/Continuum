#!/usr/bin/env node
/** Offline by default. Paid execution requires a separate explicit approval flag. */
import {cp,mkdtemp,mkdir,readFile,writeFile,appendFile,rm,copyFile,access,realpath} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {randomInt} from "node:crypto";
import {capturePolicyFor,redactString} from "../packages/shared/dist/index.js";
import {isolateCodex} from "./recovery-isolation.mjs";
import {hostRetryAssessment,assertHostRetries,acquireExperimentLock,SmokeSafety,smokeFeatureOverrides} from "./recovery-safety.mjs";
import {prepareTaskBaseline} from "./phase6-task-setup.mjs";
import {verifyBehavior} from "./phase6-behavior.mjs";
const exec=promisify(execFile),root=resolve(dirname(fileURLToPath(import.meta.url)),".."),cli=join(root,"apps/cli/dist/main.js");
export const recoveryCases=[
  {id:"authentication-compatibility",fixture:"small-ts",validator:"small-security-token",task:"Fix AuthService validation and refresh. Reject empty and literal expired tokens. Preserve method signatures and return <token>-refreshed for valid tokens.",continuation:"Complete the authentication fix and validate the original compatibility and security requirements."},
  {id:"cross-file-refactor",fixture:"monorepo",validator:"mono-cross-user-session",task:"Repair session creation and API updateUser together. Preserve interfaces. A valid user's session must contain their user ID and a session ID session-<userId>. updateUser must return the requested user ID.",continuation:"Finish the cross-file change and verify the original contracts across core and API."},
  {id:"migration-rollback",fixture:"sql-docs",validator:"sql-security-refresh",task:"Repair the users and refresh-token migrations. Keep email uniqueness and store a refresh-token hash. Rollback must remove only the added refresh-token schema and preserve existing users and email uniqueness.",continuation:"Verify both forward migration and rollback, including preservation of existing data."},
  {id:"debugging-cache",fixture:"small-ts",validator:"small-local-cache-timeout",task:"Investigate stale timeout cache reads. readCache('timeout') must return undefined; other keys retain their established return behavior. Preserve the public function signature.",continuation:"Finish the investigation and validate both timeout behavior and unaffected cache keys."},
  {id:"changed-requirement",fixture:"small-ts",validator:"small-config-timeout",expectedConfigTimeout:7000,task:"Make the YAML configuration and loadAppConfig agree on a 5000 millisecond timeout. Preserve the configuration shape.",continuation:"Correction: the timeout must now be 7000 milliseconds, superseding 5000. Keep YAML and loadAppConfig consistent and preserve configuration shape."},
  {id:"late-compatibility",fixture:"small-ts",validator:"small-api-contract",task:"Repair UserController.getUser. Preserve its public asynchronous interface, and return the originally requested user ID for every input. Do not replace it with a hard-coded identifier.",continuation:"Finish the API repair and verify its original interface and behavior for several different user IDs."},
];
const args=process.argv.slice(2),has=name=>args.includes(name),value=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const flags=new Set(["--offline","--dry-run","--mock","--run","--approved-live","--accept-known-host-retries","--help"]),valued=new Set(["--output","--transition","--timeout-ms","--token-ceiling","--case","--treatment","--repetition"]);
for(let i=0;i<args.length;i++){if(flags.has(args[i]))continue;if(!valued.has(args[i]))throw new Error("Unknown option: "+args[i]);if(!args[i+1]||args[i+1].startsWith("--"))throw new Error("Missing value for "+args[i]);i++;}
const offline=has("--offline"),dry=has("--dry-run"),mock=has("--mock"),live=has("--run");
if(has("--help")){console.log("Usage: node scripts/recovery-benchmark.mjs --offline | --dry-run | --mock | --run --approved-live --treatment A|B|C --case <id>\nOptions: --output <directory>, --transition restart|compaction, --timeout-ms <1000..180000>, --token-ceiling <1..30000>\n--dry-run and --offline never start a model. --mock uses a fake protocol process. --run may consume credits and is blocked without explicit approval. Live execution is restricted to Treatment C, authentication-compatibility, --transition compaction, --timeout-ms 60000, --token-ceiling 20000 and repetition 1. It uses gpt-5.6-luna with low reasoning, at most two turns and one compaction; unverified host retries block inference.");process.exit(0);}
if([offline,dry,mock,live].filter(Boolean).length!==1)throw new Error("Select exactly one of --offline, --dry-run, --mock, or --run.");
if(live&&!has("--approved-live"))throw new Error("Paid benchmark blocked: explicit approval is required; use --dry-run first.");
if(offline){await exec(process.execPath,["--test",join(root,"scripts/durable-recovery.test.mjs")],{cwd:root,timeout:120000,maxBuffer:4*1024*1024}).then(result=>console.log(result.stdout));process.exit(0);}
const selectedCase=value("--case",null),cases=selectedCase?recoveryCases.filter(item=>item.id===selectedCase):recoveryCases;
if(!cases.length)throw new Error("Unknown recovery case.");
const treatment=value("--treatment",null);
if(live&&(!selectedCase||!["A","B","C"].includes(treatment)))throw new Error("A live invocation must explicitly select exactly one case and treatment.");
const repetition=Number(value("--repetition","1"));if(!Number.isInteger(repetition)||repetition<1||repetition>10)throw new Error("Repetition must be an integer between 1 and 10.");
const timeout=Number(value("--timeout-ms","60000")),ceiling=Number(value("--token-ceiling","20000")),transition=value("--transition","restart");
if(!Number.isInteger(timeout)||timeout<1000||timeout>180000||!Number.isInteger(ceiling)||ceiling<1||ceiling>30000||!["restart","compaction"].includes(transition))throw new Error("Invalid execution limits or transition.");
if(live&&(treatment!=="C"||selectedCase!=="authentication-compatibility"||transition!=="compaction"||timeout!==60000||ceiling!==20000||repetition!==1))throw new Error("This live runner is limited to the single approved C smoke experiment and its fixed limits.");
const output=resolve(value("--output",join(root,".continuum/recovery-benchmark",new Date().toISOString().replaceAll(":","-"))));await mkdir(output,{recursive:true});
try{await access(join(output,"report.json"));throw new Error("Output already contains a report; choose a fresh directory.");}catch(error){if(error.code!=="ENOENT")throw error;}
const scratch=await mkdtemp(join(tmpdir(),"continuum-recovery-benchmark-")),records=[];
let watchdog=null;
if(live){const executable=await realpath(`/proc/${process.ppid}/exe`),args=(await readFile(`/proc/${process.ppid}/cmdline`,"utf8")).split("\0");if(executable!=="/usr/bin/timeout"||!args.includes("240s")||!args.includes("--kill-after=10s")||!args.includes("--signal=TERM"))throw new Error("Required external GNU timeout watchdog was not verified; no inference started.");watchdog={executable,overallSeconds:240,killGraceSeconds:10,verified:true};}
const run=(cwd,...argv)=>exec(process.execPath,[cli,...argv],{cwd,timeout:30000,maxBuffer:1024*1024});
const git=(cwd,...argv)=>exec("git",argv,{cwd,timeout:10000,env:{...process.env,GIT_AUTHOR_DATE:"2026-10-12T00:00:00Z",GIT_COMMITTER_DATE:"2026-10-12T00:00:00Z"}});
let metadata=null;
if(live){await exec(process.execPath,[join(root,"scripts/codex-model-inspect.mjs"),"--output",join(output,"model-inspection.json")],{timeout:20000});metadata=JSON.parse(await readFile(join(output,"model-inspection.json"),"utf8"));if(!metadata.matches?.some(model=>model.model==="gpt-5.6-luna"&&model.supportedReasoningEfforts?.some(item=>item.reasoningEffort==="low"))||metadata.nextCursor||!metadata.configMetadataAvailable||!metadata.authenticated)throw new Error("Requested model/effort or complete MCP configuration metadata unavailable; no inference started.");}
const configOverrides={model_provider:"openai",...smokeFeatureOverrides,...Object.fromEntries((metadata?.configuredMcpServers??[]).map(name=>{if(!/^[A-Za-z0-9_-]+$/.test(name))throw new Error("Cannot safely disable configured MCP server: "+name);return["mcp_servers."+name+".enabled",false];}))};
try {
  for(const task of cases){
    const base=join(scratch,task.id);await cp(join(root,"packages/context-engine/benchmarks/v1/repositories",task.fixture),base,{recursive:true});await prepareTaskBaseline(base,task.validator);await writeFile(join(base,".gitignore"),".continuum/\nnode_modules/\n");
    for(const argv of [["init"],["config","user.name","Continuum evaluator"],["config","user.email","evaluator@example.test"],["add","."],["commit","-m","evaluation baseline"]])await git(base,...argv);
    const commit=(await git(base,"rev-parse","HEAD")).stdout.trim(),baseline=await verifyBehavior({repository:base,taskId:task.validator,hidden:true,expectedConfigTimeout:task.expectedConfigTimeout});
    if(baseline.status!=="failed")throw new Error("Fixture must fail independent baseline validation: "+task.id);
    const order=treatment?[treatment]:["A","B","C"];
    if(order.some(arm=>!["A","B","C"].includes(arm)))throw new Error("Invalid treatment.");
    if(!live)for(let i=order.length-1;i>0;i--){const j=randomInt(i+1);[order[i],order[j]]=[order[j],order[i]];}
    for(const arm of order){
      const setupStartedAt=Date.now();const cwd=join(scratch,task.id+"-"+arm);await cp(base,cwd,{recursive:true});await run(cwd,"init","--non-interactive");await run(cwd,"index");
      const configuration={model:"gpt-5.6-luna",reasoningEffort:"low",approvalPolicy:"never",sandbox:"workspace-write",timeoutMs:timeout,maximumReportedTokens:ceiling,persistentSession:true,contextEnabled:arm!=="A",durableMemory:arm==="C",nativeCompactionPrompt:true,configOverrides};
      const record={caseId:task.id,repetition,treatment:arm,initialCommit:commit,task:task.task,continuation:task.continuation,configuration,transition,mode:dry?"dry-run":mock?"mock":"live",baseline,setupVerified:true,setupDurationMs:Date.now()-setupStartedAt,behavioralSuccess:null,agentCompleted:null,criticalRequirementRetention:null,exactEvidenceRecovery:null,retrievalMisses:null,staleContextErrors:null,repeatedExploration:null,modelCalls:null,inputTokens:null,cachedInputTokens:null,outputTokens:null,recoveryEstimatedTokens:null,totalAttributableCost:null,costMeasurement:"unavailable",genuineCompactions:0,simulatedCompactions:0,compactionEvidence:[],generationTurnRequests:0,compactionRequests:0,usageIncludesCompaction:null,hiddenValidatorIsolation:"not established",decisionReady:false};records.push(record);
      const isolated=await isolateCodex({cwd,projectRoot:root,codexHome:metadata?.codexHome??process.env.HOME+"/.codex",copyCredentials:false});record.hiddenValidatorIsolation={...isolated.isolation,appliedToAgentProcess:false};record.codexVersion=isolated.codexVersion;
      record.runtimePreflight=isolated.preflight;await writeFile(join(output,task.id+"-"+arm+"-runtime-preflight.json"),JSON.stringify(isolated.preflight,null,2));
      record.hostRetries=hostRetryAssessment(isolated.codexVersion);
      if(live) {
        record.hostRetries.acceptedForSingleExperiment=has("--accept-known-host-retries");
        try {assertHostRetries(record.hostRetries,record.hostRetries.acceptedForSingleExperiment);}
        catch(error) {
          record.preflightStatus="blocked";record.failure=String(error);record.executionDurationMs=0;
          await cp(cwd,join(output,"prepared-workspace"),{recursive:true});
          await writeFile(join(output,"report.json"),JSON.stringify({schemaVersion:"continuum.recovery-benchmark.v1",records,liveTreatmentRuns:0,generationTurnRequests:0,compactionRequests:0,retries:0,paidInferenceUsage:"not requested; provider usage unavailable",decisionReady:false},null,2));
          throw error;
        }
        await acquireExperimentLock(join(root,".continuum/approved-recovery-smoke.lock"));
        const authenticatedIsolation=await isolateCodex({cwd,projectRoot:root,codexHome:metadata.codexHome,copyCredentials:true});Object.assign(isolated,authenticatedIsolation);record.hiddenValidatorIsolation={...isolated.isolation,appliedToAgentProcess:true};
      }
      if(dry){
        if(treatment&&cases.length===1&&arm==="C") {
          const {RepositoryContextSessionService}=await import(pathToFileURL(join(root,"packages/context-engine/dist/index.js")));
          const memory=await RepositoryContextSessionService.open(cwd);
          try{const started=await memory.start({task:task.task,createInitialContext:true});const checkpoint=await memory.memory.checkpoint(started.session.id,"offline-smoke-preparation");const state=memory.memory.state(started.session.id);record.offlineRequirements={sessionId:started.session.id,originalEvidencePreserved:state.evidence.some(item=>item.text===task.task),recoverable:checkpoint.packet.renderedContent.includes(task.task),incomplete:checkpoint.packet.incomplete};await writeFile(join(output,"offline-recovery.json"),JSON.stringify(checkpoint,null,2));}
          finally{memory.close();}
          await cp(cwd,join(output,"prepared-workspace"),{recursive:true});
        }
        continue;
      }
      const {CodexAssistExecutionService,StdioCodexAppServerClient}=await import(pathToFileURL(join(root,"packages/codex-app-server/dist/index.js"))),{RepositoryContextSessionService}=await import(pathToFileURL(join(root,"packages/context-engine/dist/index.js"))),{openDatabase}=await import(pathToFileURL(join(root,"packages/database/dist/index.js")));
      const tracePath=join(output,task.id+"-"+arm+"-trace.jsonl");let trace="";
      const safety=live?new SmokeSafety(event=>{trace+=JSON.stringify({timestamp:new Date().toISOString(),...event})+"\n";}):null;
      const processOptions=mock?{executable:process.execPath,executableArgs:[join(root,"packages/codex-app-server/tests/fixtures/fake-app-server.mjs")],env:{...process.env,FAKE_CODEX_SCENARIO:"modern-compaction"}}:{...isolated,terminateProcessGroup:true,shutdownTimeoutMs:2000,maximumOutputBytes:64*1024*1024,onRawMessage:async message=>{trace+=redactString(JSON.stringify(message),capturePolicyFor(cwd).redactPatterns)+"\n";try{safety.observeRaw(message,task.task);}finally{await appendFile(tracePath,trace);trace="";}}};
      const runner=new CodexAssistExecutionService();const startedAt=Date.now();let sessionId;
      try {
        if(live){await writeFile(join(output,"configuration.json"),JSON.stringify({configuration,hostRetries:record.hostRetries,watchdog,isolation:record.hiddenValidatorIsolation,startedAt:new Date().toISOString(),workspace:cwd},null,2));await cp(base,join(output,"original-fixture"),{recursive:true});}
        record.generationTurnRequests++;const first=await runner.runAssist({...configuration,cwd,task:task.task,process:processOptions,codexVersionOverride:mock?"fixture":isolated.codexVersion});sessionId=first.sessionId;record.sessionId=sessionId;await writeFile(join(output,task.id+"-"+arm+"-first.json"),JSON.stringify(first,null,2));
        if(first.report.execution.status!=="completed")throw new Error("First turn did not complete.");
        if(live&&!first.report.usage.accumulated)throw new Error("Provider usage missing after first turn; no further paid operations allowed.");
        if(live){const memory=await RepositoryContextSessionService.open(cwd);try{memory.memory.write(sessionId,{kind:"completed",text:"The first Codex generation completed; implementation correctness remains subject to independent validation. Execution "+first.executionId,authority:"observed",operationKey:"smoke-first-completed"});memory.memory.write(sessionId,{kind:"next_action",text:"Recover original requirements after native compaction, then perform final continuation and independent behavioral validation.",authority:"observed",operationKey:"smoke-next-action"});await writeFile(join(output,"memory-before-compaction.json"),JSON.stringify(memory.memory.state(sessionId),null,2));}finally{memory.close();}}
        if(transition==="compaction"){
          const database=openDatabase(join(cwd,".continuum/continuum.db"));let binding;try{binding=database.prepare("SELECT thread_id FROM codex_session_bindings WHERE session_id=?").get(sessionId);}finally{database.close();}
          const sessions=await RepositoryContextSessionService.open(cwd),client=new StdioCodexAppServerClient();
          try {await client.start({...processOptions,cwd,requestTimeoutMs:Math.min(timeout,30000),onNotification:async(method,params)=>{if(method==="thread/tokenUsage/updated"&&typeof params?.tokenUsage?.total?.totalTokens==="number"&&params.tokenUsage.total.totalTokens>=ceiling)throw new Error("Reported token ceiling reached during compaction.");if(method==="item/completed"&&params?.item?.type==="contextCompaction"&&params.threadId===binding.thread_id&&!record.compactionEvidence.some(event=>event.itemId===params.item.id)){record.compactionEvidence.push({method,threadId:params.threadId,turnId:params.turnId,itemId:params.item.id,itemType:params.item.type,observedAt:new Date().toISOString(),origin:mock?"mock":"host",trigger:"thread/compact/start"});record[mock?"simulatedCompactions":"genuineCompactions"]++;await sessions.checkpoint(sessionId);if(arm==="C")await sessions.memory.checkpoint(sessionId,"compaction:"+params.item.id);}}});await client.initialize({experimentalApi:true});await client.resumeThread(binding.thread_id,{cwd,...configuration});record.compactionRequests++;await client.compactThread(binding.thread_id);}finally{await client.close();sessions.close();}
          if(!(record.genuineCompactions||record.simulatedCompactions))throw new Error("Compaction completion was not evidenced.");
        }
        if(live){const memory=await RepositoryContextSessionService.open(cwd);try{const recovery=await memory.memory.recover(sessionId);await writeFile(join(output,"recovered-context.json"),JSON.stringify(recovery,null,2));record.exactEvidenceRecovery=!recovery.incomplete&&recovery.renderedContent.includes(task.task);if(!record.exactEvidenceRecovery)throw new Error("Original requirements not recovered before continuation.");}finally{memory.close();}}
        record.generationTurnRequests++;let supersedesMemoryId;
        if(arm==="C"&&task.id==="changed-requirement"){const memory=await RepositoryContextSessionService.open(cwd);try{supersedesMemoryId=memory.memory.state(sessionId).entries.find(entry=>entry.kind==="objective"&&!entry.supersededBy).id;}finally{memory.close();}}
        const second=await runner.runAssist({...configuration,cwd,task:task.continuation,supersedesMemoryId,resumeSessionId:sessionId,process:processOptions,codexVersionOverride:mock?"fixture":isolated.codexVersion});await writeFile(join(output,task.id+"-"+arm+"-second.json"),JSON.stringify(second,null,2));
        const visible=await verifyBehavior({repository:cwd,taskId:task.validator,hidden:false,expectedConfigTimeout:task.expectedConfigTimeout}),hidden=await verifyBehavior({repository:cwd,taskId:task.validator,hidden:true,expectedConfigTimeout:task.expectedConfigTimeout});record.validation={visible,hidden};record.agentCompleted=second.report.execution.status==="completed";record.behavioralSuccess=second.report.execution.status==="completed"&&visible.status==="passed"&&hidden.status==="passed";
        const database=openDatabase(join(cwd,".continuum/continuum.db"));try {const usage=database.prepare("SELECT * FROM codex_usage_snapshots WHERE execution_id=? AND accumulation='accumulated' ORDER BY rowid DESC LIMIT 1").get(second.executionId);if(usage&&!mock){record.inputTokens=usage.input_tokens;record.cachedInputTokens=usage.cached_input_tokens;record.outputTokens=usage.output_tokens;}record.recoveryEstimatedTokens=database.prepare("SELECT SUM(json_extract(recovery_json,'$.estimatedTokens')) n FROM task_checkpoints WHERE session_id=? AND status='delivered'").get(sessionId).n??0;}finally{database.close();}
      } catch(error){record.failure=String(error);record.behavioralSuccess=false;}
      finally {record.executionDurationMs=Date.now()-startedAt;record.durationMs=Date.now()-setupStartedAt;if(live){record.safetyUsage=safety.usage;record.observableGenerationRequests=safety.turns;record.continuumRetries=0;await appendFile(tracePath,trace);await cp(cwd,join(output,"final-fixture"),{recursive:true,filter:path=>path!==join(cwd,".continuum")});}const finalDatabase=openDatabase(join(cwd,".continuum/continuum.db"));try{record.generationTurnRequests=finalDatabase.prepare("SELECT COUNT(*) n FROM codex_raw_events WHERE method='turn/start' AND direction='client_to_server'").get().n;}finally{finalDatabase.close();}await copyFile(join(cwd,".continuum/continuum.db"),join(output,task.id+"-"+arm+".db"));const policy=capturePolicyFor(cwd);await writeFile(join(output,task.id+"-"+arm+".diff"),policy.captureRawOutput===false?"[capture disabled]":redactString((await git(cwd,"diff")).stdout,policy.redactPatterns));await writeFile(join(output,"report.json"),JSON.stringify({schemaVersion:"continuum.recovery-benchmark.v1",records,liveTreatmentRuns:live?records.filter(item=>item.generationTurnRequests>0).length:0,paidInferenceUsage:live?"see reported usage; unavailable fields are null":"no paid inference requested",decisionReady:false},null,2));}
    }
  }
  await writeFile(join(output,"report.json"),JSON.stringify({schemaVersion:"continuum.recovery-benchmark.v1",records,liveTreatmentRuns:live?records.filter(item=>item.generationTurnRequests>0).length:0,paidInferenceUsage:live?"see reported usage; unavailable fields are null":"no paid inference requested",decisionReady:false},null,2));
  console.log(JSON.stringify({output,mode:dry?"dry-run":mock?"mock":"live",preparedCells:records.length,liveTreatmentRuns:live?records.length:0,decisionReady:false},null,2));
}finally{await rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
