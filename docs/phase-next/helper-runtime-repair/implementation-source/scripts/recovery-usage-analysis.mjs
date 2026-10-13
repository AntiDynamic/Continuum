import {readFile,readdir} from "node:fs/promises";
import {join} from "node:path";

/** Analyze preserved native evidence only. No tokenizer estimate, model/API call or price assumption. */
export async function analyzeRecoveryUsage(directory) {
  const rows=[];async function visit(path){for(const entry of await readdir(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())await visit(file);else if(entry.name.endsWith(".jsonl"))rows.push(...(await readFile(file,"utf8")).split("\n").filter(Boolean).map(line=>JSON.parse(line)));}}
  await visit(join(directory,"native-rollouts"));
  const records=new Map();for(const row of rows)if(row.type==="token_usage_record"){
    const record=row.payload;if(typeof record.response_id!=="string"||!record.response_id)throw new Error("Response identity is unavailable.");const previous=records.get(record.response_id);if(previous&&JSON.stringify(previous)!==JSON.stringify(record))throw new Error("Conflicting usage for the same response ID.");records.set(record.response_id,record);
  }
  if(!records.size)throw new Error("Native response usage is unavailable.");
  const responses=[...records.values()].map(record=>{
    const u=record.usage;
    if(!u||![u.input_tokens,u.cached_input_tokens,u.output_tokens,u.total_tokens].every(value=>Number.isSafeInteger(value)&&value>=0)||u.cached_input_tokens>u.input_tokens)throw new Error("Invalid provider usage record.");
    return {responseId:record.response_id,turnId:record.turn_id,inputTokens:u.input_tokens,cachedInputTokens:u.cached_input_tokens,uncachedInputTokens:u.input_tokens-u.cached_input_tokens,outputTokens:u.output_tokens,totalTokens:u.total_tokens};
  });
  const sum=field=>responses.reduce((total,row)=>total+row[field],0);
  const meta=rows.find(row=>row.type==="session_meta")?.payload;
  const trace=(await readFile(join(directory,"authentication-compatibility-C-trace.jsonl"),"utf8")).split("\n").filter(Boolean).map(line=>JSON.parse(line));
  const input=trace.find(row=>row.direction==="client_to_server"&&row.method==="turn/start")?.parsed?.params?.input;
  const textItems=rows.filter(row=>row.type==="response_item"&&row.payload.type==="message").map(row=>({role:row.payload.role,text:(row.payload.content??[]).map(item=>item.text??"").join("")}));
  const chars=text=>[...(text??"")].length;
  return {classification:"Analysis of preserved evidence; no inference requested",inferenceRequests:0,providerReportedResponses:responses,totals:{inputTokens:sum("inputTokens"),cachedInputTokens:sum("cachedInputTokens"),uncachedInputTokens:sum("uncachedInputTokens"),outputTokens:sum("outputTokens"),totalTokens:sum("totalTokens")},visibleContext:{measurement:"observed Unicode character counts, not tokens or billing",hostBaseInstructions:chars(meta?.base_instructions?.text),nativeDeveloperMessages:textItems.filter(row=>row.role==="developer").map(row=>chars(row.text)),nativeUserMessages:textItems.filter(row=>row.role==="user").map(row=>chars(row.text)),continuumTurnInputs:(input??[]).map(row=>chars(row.text)),dynamicToolMetadataSerialized:meta?.dynamic_tools?chars(JSON.stringify(meta.dynamic_tools)):null,toolFailureOutputs:rows.filter(row=>row.type==="response_item"&&row.payload.type==="custom_tool_call_output").map(row=>chars(row.payload.output))},interpretation:[`${sum("totalTokens")} is summed across ${responses.length} response records in ${new Set(responses.map(row=>row.turnId)).size} logical turn(s), not a single input context size.`,"Cached input is a subset of input. Uncached input is computed from reported input minus reported cached input.","Host base/developer instructions are observable separately from Continuum rendered input. Exact provider tokens per fragment and full serialized provider requests are unavailable.","Tool error outputs and repeated input do not establish provider transport retries.","Provider billing rates, final attributable cost and remote cancellation accounting are unavailable."]};
}
