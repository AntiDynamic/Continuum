import type { ContextControlSignal, ContextCoverageCategory, ContextRequestReason } from "@continuum/shared";
import { isRecord } from "./json.js";
import type { CodexServerRequestContext } from "./protocol.js";
import type { DynamicToolCallResponse } from "./protocol-adapters/0.133.0/dynamic-tools.js";
import { buildAssistToolFailureResult, serializeAssistContextToolResult } from "./assist-tool-result.js";

export interface ContextToolRequest { query:string; reason:ContextRequestReason; requestedSymbols?:string[]; requestedPaths?:string[]; requestedCoverage?:ContextCoverageCategory[]; }
export interface ContextSignalToolRequest { signal:ContextControlSignal; }
export interface AssistToolRouterOptions { threadId?:()=>string|null; turnId?:()=>string|null; maximumCalls?:number; failureContext?:()=>{sessionId:string;sessionEstimatedTokensUsed:number;remainingEstimatedTokens:number}; executionActive?:()=>boolean; sessionActive?:()=>boolean; snapshotMatches?:()=>boolean|Promise<boolean>; }
export interface ContextToolHandlerResult { success:boolean; text:string; }
const reasons=new Set<string>(["missing_implementation","missing_test","missing_contract","missing_constraint","test_failure","scope_check","other"]);
const isReason=(value:string):value is ContextRequestReason=>reasons.has(value);
const coverage=new Set<string>(["implementation","public_contract","tests","configuration","architecture","security_constraint","database_schema","rollback","dependency","documentation","historical_episode","repository_state"]);
const isCoverage=(value:string):value is ContextCoverageCategory=>coverage.has(value);
const response=(success:boolean,text:string):DynamicToolCallResponse=>({success,contentItems:[{type:"inputText",text}]});
const strings=(value:unknown,maximum:number):string[]|null=>Array.isArray(value)&&value.length<=maximum&&value.every((entry)=>typeof entry==="string"&&entry.length>0)?value:null;
const validPath=(path:string):boolean=>path.length<=500&&!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path)&&!path.split(/[\\/]/).includes("..");
const coverageRequest=(value:unknown):ContextCoverageCategory[]|null=>{const values=strings(value,12);if(values===null)return null;const result:ContextCoverageCategory[]=[];for(const entry of values){if(!isCoverage(entry))return null;result.push(entry);}return result;};
function identity(params:Record<string,unknown>,options:AssistToolRouterOptions):string|null{const threadId=typeof params["threadId"]==="string"?params["threadId"]:null;const turnId=typeof params["turnId"]==="string"?params["turnId"]:null;const callId=typeof params["callId"]==="string"?params["callId"]:null;const namespace=params["namespace"];if(!callId||callId.length>200)return "INVALID_CALL_ID";if(namespace!==null&&namespace!=="continuum")return "INVALID_NAMESPACE";const activeThread=options.threadId?.(),activeTurn=options.turnId?.();if(activeThread!==undefined&&threadId!==activeThread)return "INVALID_THREAD";if(activeTurn!==undefined&&turnId!==activeTurn)return "INVALID_TURN";return null;}
function failureCode(error:unknown,fallback:string):string {const name=error instanceof Error?error.constructor.name:"";if(name==="IndexedSnapshotMismatchError")return "SNAPSHOT_MISMATCH";if(name==="ContextEscalationLimitError")return "TOOL_CALL_LIMIT";return fallback;}
function signalRequest(value:Record<string,unknown>):ContextSignalToolRequest|null { const type=value["type"];if(type==="agent_context_request"){const query=typeof value["query"]==="string"?value["query"].trim():"";if(!query)return null;return {signal:{type,query}};}if(type==="test_failure"){const failingTests=strings(value["failingTests"],20),errorSummary=typeof value["errorSummary"]==="string"?value["errorSummary"]:"";return failingTests===null||!errorSummary?null:{signal:{type,failingTests,errorSummary}};}if(type==="missing_coverage"){const categories=coverageRequest(value["categories"]);return categories===null?null:{signal:{type,categories}};}if(type==="out_of_scope_modification"){const modifiedPaths=strings(value["modifiedPaths"],20),predictedPaths=strings(value["predictedPaths"],20);return modifiedPaths===null||predictedPaths===null||modifiedPaths.some((path)=>!validPath(path))||predictedPaths.some((path)=>!validPath(path))?null:{signal:{type,modifiedPaths,predictedPaths}};}return null;}

export class AssistToolRouter {
  private calls=0;
  private failure(code:string,message=code):DynamicToolCallResponse {
    const context=this.options.failureContext?.()??{sessionId:"unavailable",sessionEstimatedTokensUsed:0,remainingEstimatedTokens:0};
    const result=buildAssistToolFailureResult({...context,failureCode:code,failureMessage:message,toolCallsUsed:this.calls,maximumToolCalls:this.options.maximumCalls??8});
    return response(false,serializeAssistContextToolResult(result));
  }
  constructor(private readonly onContextRequest:(request:ContextToolRequest,toolCallsUsed:number)=>Promise<ContextToolHandlerResult>,private readonly onContextSignal:((request:ContextSignalToolRequest)=>Promise<string>)|undefined,private readonly options:AssistToolRouterOptions={}) {}
  async handleRequest(request:CodexServerRequestContext):Promise<DynamicToolCallResponse|null>{
    if(request.method!=="item/tool/call")return null;
    if(!isRecord(request.params))return this.failure("INVALID_ARGUMENTS");
    const params=request.params,tool=typeof params["tool"]==="string"?params["tool"]:"";
    if(tool!=="continuum_request_context"&&tool!=="continuum_report_context_signal")return this.failure("UNKNOWN_TOOL");
    const identityFailure=identity(params,this.options);if(identityFailure)return this.failure(identityFailure);
    if(this.options.executionActive&&!this.options.executionActive())return this.failure("EXECUTION_NOT_RUNNING");
    if(this.options.sessionActive&&!this.options.sessionActive())return this.failure("SESSION_NOT_ACTIVE");
    if(this.options.snapshotMatches){try{if(!(await this.options.snapshotMatches()))return this.failure("SNAPSHOT_MISMATCH");}catch{return this.failure("SNAPSHOT_MISMATCH");}}
    if(!isRecord(params["arguments"]))return this.failure("INVALID_ARGUMENTS");
    const args=params["arguments"];
    if(tool==="continuum_report_context_signal"){const signal=signalRequest(args);if(!signal)return this.failure("INVALID_ARGUMENTS");try{return response(true,await this.onContextSignal?.(signal)??"CONTEXT_SIGNAL_UNAVAILABLE");}catch(error){return this.failure(failureCode(error,"SIGNAL_FAILED"));}}
    const allowed=new Set(["query","reason","requestedSymbols","requestedPaths","requestedCoverage"]);
    if(Object.keys(args).some((key)=>!allowed.has(key)))return this.failure("INVALID_ARGUMENTS");
    const query=typeof args["query"]==="string"?args["query"].trim():"",reason=typeof args["reason"]==="string"?args["reason"]:null;
    if(!query||query.length>2000||!reason||!isReason(reason))return this.failure("INVALID_ARGUMENTS");
    const requestedSymbols=args["requestedSymbols"]===undefined?undefined:strings(args["requestedSymbols"],20);
    const requestedPaths=args["requestedPaths"]===undefined?undefined:strings(args["requestedPaths"],20);
    const requestedCoverage=args["requestedCoverage"]===undefined?undefined:coverageRequest(args["requestedCoverage"]);
    if(requestedSymbols===null||requestedPaths===null||requestedCoverage===null||requestedSymbols?.some((entry)=>entry.length>300)||requestedPaths?.some((entry)=>!validPath(entry)))return this.failure("INVALID_ARGUMENTS");
    if(this.calls>=(this.options.maximumCalls??8))return this.failure("TOOL_CALL_LIMIT");
    this.calls+=1;
    try{const result=await this.onContextRequest({query,reason,...(requestedSymbols?{requestedSymbols}:{}),...(requestedPaths?{requestedPaths}:{}),...(requestedCoverage?{requestedCoverage}:{})},this.calls);return response(result.success,result.text);}catch(error){return this.failure(failureCode(error,"CONTEXT_REQUEST_FAILED"));}
  }
}