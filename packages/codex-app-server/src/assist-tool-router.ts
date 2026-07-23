import { isRecord } from "./json.js";
import type { CodexServerRequestContext } from "./protocol.js";
import type { DynamicToolCallResponse } from "./protocol-adapters/0.133.0/dynamic-tools.js";

export interface ContextToolRequest { query:string; reason:"missing_implementation"|"missing_test"|"missing_contract"|"missing_constraint"|"test_failure"|"scope_check"|"other"; requestedSymbols?:string[]; requestedPaths?:string[]; requestedCoverage?:string[]; }
export interface AssistToolRouterOptions { threadId?:()=>string|null; turnId?:()=>string|null; maximumCalls?:number; }
const reasons=new Set<ContextToolRequest["reason"]>(["missing_implementation","missing_test","missing_contract","missing_constraint","test_failure","scope_check","other"]);
const coverage=new Set(["implementation","public_contract","tests","configuration","architecture","security_constraint","database_schema","rollback","dependency","documentation","historical_episode","repository_state"]);
const response=(success:boolean,text:string):DynamicToolCallResponse=>({success,contentItems:[{type:"inputText",text}]});
const strings=(value:unknown,maximum:number):string[]|null=>Array.isArray(value)&&value.length<=maximum&&value.every((entry)=>typeof entry==="string"&&entry.length>0)?value:null;
const validPath=(path:string):boolean=>path.length<=500&&!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path)&&!path.split(/[\\/]/).includes("..");

export class AssistToolRouter {
  private calls=0;
  constructor(private readonly onContextRequest:(request:ContextToolRequest)=>Promise<string>,private readonly options:AssistToolRouterOptions={}) {}
  async handleRequest(request:CodexServerRequestContext):Promise<DynamicToolCallResponse|null>{
    if(request.method!=="item/tool/call")return null;
    if(!isRecord(request.params))return response(false,"Invalid dynamic-tool request.");
    const params=request.params;
    if(params["tool"]!=="continuum_request_context")return null;
    const threadId=typeof params["threadId"]==="string"?params["threadId"]:null,turnId=typeof params["turnId"]==="string"?params["turnId"]:null,callId=typeof params["callId"]==="string"?params["callId"]:null;
    if(!callId||callId.length>200||this.options.threadId?.()!==undefined&&threadId!==this.options.threadId?.()||this.options.turnId?.()!==undefined&&turnId!==this.options.turnId?.())return response(false,"Invalid tool-call identity.");
    if(!isRecord(params["arguments"]))return response(false,"Invalid tool arguments.");
    const args=params["arguments"],allowed=new Set(["query","reason","requestedSymbols","requestedPaths","requestedCoverage"]);
    if(Object.keys(args).some((key)=>!allowed.has(key)))return response(false,"Unknown tool argument.");
    const query=typeof args["query"]==="string"?args["query"].trim():"",reason=typeof args["reason"]==="string"?args["reason"]:null;
    if(!query||query.length>2000||!reason||!reasons.has(reason as ContextToolRequest["reason"]))return response(false,"Invalid query or reason.");
    const requestedSymbols=args["requestedSymbols"]===undefined?undefined:strings(args["requestedSymbols"],20);
    const requestedPaths=args["requestedPaths"]===undefined?undefined:strings(args["requestedPaths"],20);
    const requestedCoverage=args["requestedCoverage"]===undefined?undefined:strings(args["requestedCoverage"],12);
    if(requestedSymbols===null||requestedPaths===null||requestedCoverage===null||requestedSymbols?.some((entry)=>entry.length>300)||requestedPaths?.some((entry)=>!validPath(entry))||requestedCoverage?.some((entry)=>!coverage.has(entry)))return response(false,"Invalid requested context filters.");
    if(this.calls>=(this.options.maximumCalls??8))return response(false,"Context tool-call limit reached.");
    this.calls+=1;
    try{return response(true,await this.onContextRequest({query,reason:reason as ContextToolRequest["reason"],...(requestedSymbols?{requestedSymbols}:{}),...(requestedPaths?{requestedPaths}:{}),...(requestedCoverage?{requestedCoverage}:{})}));}catch{return response(false,"Context request could not be fulfilled.");}
  }
}