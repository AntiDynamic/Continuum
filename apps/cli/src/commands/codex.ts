import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  CodexExecutionService, CodexIntegrationError,
  type CodexApprovalDecision, type CodexApprovalPolicy, type CodexSandboxMode,
  type CodexServerRequestContext, type ShadowFlightRecorderReport,
} from "@continuum/codex-app-server";
import { blank, bold, kv, line, section } from "../display.js";

export interface CodexRunOptions { cwd:string; repo?:string; mode:string; model?:string; approvalPolicy?:string; sandbox?:string; json?:boolean; report?:string; timeout?:string; experimentalRawUsage?:boolean; sessionBudget?:string; maxContextToolCalls?:string; maxContextResultTokens?:string }
export interface CodexReadOptions { cwd:string; repo?:string; json?:boolean; limit?:string }
const approvals:CodexApprovalPolicy[]=["untrusted","on-failure","on-request","never"];
const sandboxes:CodexSandboxMode[]=["read-only","workspace-write","danger-full-access"];
function duration(value:string|undefined):number|undefined{if(!value)return undefined;const match=value.match(/^(\d+)(ms|s|m)?$/);if(!match)throw new Error("Invalid timeout. Use milliseconds, seconds (s), or minutes (m).");const number=Number(match[1]);return number*(match[2]==="m"?60000:match[2]==="s"?1000:1);}
function pct(value:number|null):string{return value===null?"n/a":(value*100).toFixed(1)+"%";}
function boundedInteger(value:string|undefined,label:string,minimum:number,maximum:number):number|undefined{if(value===undefined)return undefined;if(!/^\d+$/.test(value))throw new Error(`${label} must be an integer.`);const parsed=Number(value);if(parsed<minimum||parsed>maximum)throw new Error(`${label} must be between ${minimum} and ${maximum}.`);return parsed;}

function printReport(report:ShadowFlightRecorderReport):void{
  line(bold("CONTINUUM SHADOW FLIGHT RECORDER"));blank();kv("Schema",report.schemaVersion);kv("Task",report.execution.task);kv("Status",report.execution.status);kv("Codex",report.execution.codexVersion);kv("Model",report.execution.model??"unavailable");kv("Duration",report.execution.durationMs+" ms");
  section("Continuum prediction");kv("Estimated initial tokens",report.prediction.estimatedTokens.toLocaleString("en-US"),"estimated");kv("Predicted items",String(report.prediction.items.length));kv("Mandatory items",String(report.prediction.items.filter(i=>i.requirementState==="required").length));
  section("Codex activity");kv("Commands",String(report.exploration.commands.length));kv("Tests",String(report.exploration.tests.length));kv("Edited files",String(report.exploration.editedPaths.length));kv("Inferred reads",String(report.exploration.commandInferredReadPaths.length));kv("Searched symbols",String(report.exploration.searchedSymbols.length));kv("Diff captured",report.outcome.diffCaptured?"yes":"no");
  section("Exploration comparison");kv("Predicted and observed",String(report.comparison.predictedAndObserved.length));kv("Predicted not observed",String(report.comparison.predictedNotObserved.length));kv("Additional exploration",String(report.comparison.observedNotPredicted.length));kv("Mandatory misses",String(report.comparison.mandatoryPredictionMisses.length));kv("Observation recall",pct(report.comparison.observationRecall),"fraction of observed paths that were predicted");kv("Prediction precision",pct(report.comparison.predictionPrecision),"fraction of predicted paths that were observed");
  section("Usage");kv("Availability",report.usage.availability);if(report.usage.accumulated)line(JSON.stringify(report.usage.accumulated,null,2));
  section("Evidence limitations");for(const warning of report.evidenceWarnings)line("  "+warning);
}

async function interactiveApproval(request:CodexServerRequestContext):Promise<CodexApprovalDecision>{
  const params=request.params as Record<string,unknown>;line(bold("CODEX APPROVAL REQUEST"));kv("Type",request.method);kv("Command",String(params["command"]??"file change"));kv("Working directory",String(params["cwd"]??"unavailable"));kv("Reason",String(params["reason"]??"not provided"));kv("Additional permissions",String(params["grantRoot"]??params["proposedExecpolicyAmendment"]??"none reported"));line("Choices: accept, accept-session, decline, cancel");
  const prompt=createInterface({input,output});try{const answer=(await prompt.question("Decision: ")).trim().toLowerCase();if(answer==="accept")return"accept";if(answer==="accept-session")return"acceptForSession";if(answer==="cancel")return"cancel";return"decline";}finally{prompt.close();}
}
export async function runCodexShadow(task:string,options:CodexRunOptions):Promise<void>{
  if(options.mode!=="shadow" && options.mode!=="assist")throw new Error("Mode must be shadow or assist.");
  if(options.approvalPolicy&&!approvals.includes(options.approvalPolicy as CodexApprovalPolicy))throw new Error("Unsupported approval policy: "+options.approvalPolicy);
  if(options.sandbox&&!sandboxes.includes(options.sandbox as CodexSandboxMode))throw new Error("Unsupported sandbox mode: "+options.sandbox);
  const interactive=Boolean(process.stdin.isTTY&&!options.json);
  const { CodexAssistExecutionService } = await import("@continuum/codex-app-server");
  const service=options.mode === "assist" ? new CodexAssistExecutionService() : new CodexExecutionService();
  try{
    const fixture=process.env["NODE_ENV"]==="test"?process.env["CONTINUUM_CODEX_TEST_APP_SERVER"]:undefined;
    const runOptions = {cwd:options.cwd,repository:options.repo,task,mode:options.mode,model:options.model,approvalPolicy:(options.approvalPolicy as CodexApprovalPolicy|undefined)??"on-request",sandbox:(options.sandbox as CodexSandboxMode|undefined)??"workspace-write",timeoutMs:duration(options.timeout),experimentalRawUsage:options.experimentalRawUsage,sessionBudget:boundedInteger(options.sessionBudget,"--session-budget",1900,20000),maxContextToolCalls:boundedInteger(options.maxContextToolCalls,"--max-context-tool-calls",1,50),maxContextResultTokens:boundedInteger(options.maxContextResultTokens,"--max-context-result-tokens",250,4000),approvalHandler:interactive?interactiveApproval:undefined,...(fixture?{process:{executable:process.execPath,executableArgs:[fixture],env:process.env},codexVersionOverride:"fixture"}:{})};
    
    const result=options.mode === "assist" ? await (service as any).runAssist(runOptions) : await (service as any).runShadow(runOptions);
    
    if(options.report)await writeFile(options.report,JSON.stringify(result.report,null,2)+"\n","utf8");
    if(options.json)line(JSON.stringify(result,null,2));else{printReport(result.report);kv("Authentication mode",result.authenticationMode);if(result.compatibilityWarning)line("WARNING: "+result.compatibilityWarning);}
  }catch(error){if(error instanceof CodexIntegrationError)throw new Error(`${error.code}: ${error.message}`, { cause: error });throw error;}
}

export interface CodexCompareCliOptions extends CodexRunOptions { verifier: string; }

export async function runCodexCompare(task:string,options:CodexCompareCliOptions):Promise<void>{
  const { CodexComparisonService } = await import("@continuum/codex-app-server");
  const service = new CodexComparisonService();
  try {
    const fixture=process.env["NODE_ENV"]==="test"?process.env["CONTINUUM_CODEX_TEST_APP_SERVER"]:undefined;
    const result = await service.runComparison({cwd:options.cwd,repository:options.repo,task,model:options.model,approvalPolicy:(options.approvalPolicy as CodexApprovalPolicy|undefined)??"on-request",sandbox:(options.sandbox as CodexSandboxMode|undefined)??"workspace-write",timeoutMs:duration(options.timeout),experimentalRawUsage:options.experimentalRawUsage,verifierCommand:options.verifier,...(fixture?{process:{executable:process.execPath,executableArgs:[fixture],env:process.env},codexVersionOverride:"fixture"}:{})});
    if(options.json)line(JSON.stringify(result,null,2));else{
      line(bold("CODEX COMPARISON RUN"));blank();
      kv("Shadow Execution", result.shadowExecutionId);
      kv("Shadow Verifier Success", String(result.shadowVerifierSuccess));
      kv("Assist Execution", result.assistExecutionId);
      kv("Assist Verifier Success", String(result.assistVerifierSuccess));
    }
  } catch (error) {
    if(error instanceof CodexIntegrationError)throw new Error(`${error.code}: ${error.message}`, { cause: error });throw error;
  }
}

export async function runCodexReport(id:string,options:CodexReadOptions):Promise<void>{const report=await new CodexExecutionService().report(options.cwd,id,options.repo);if(options.json)line(JSON.stringify(report,null,2));else printReport(report);}
export async function runCodexStatus(id:string,options:CodexReadOptions):Promise<void>{const status=await new CodexExecutionService().status(options.cwd,id,options.repo);line(options.json?JSON.stringify(status,null,2):JSON.stringify(status,null,2));}
export async function runCodexList(options:CodexReadOptions):Promise<void>{const rows=await new CodexExecutionService().list(options.cwd,options.repo,options.limit?Number(options.limit):20);line(options.json?JSON.stringify(rows,null,2):JSON.stringify(rows,null,2));}
