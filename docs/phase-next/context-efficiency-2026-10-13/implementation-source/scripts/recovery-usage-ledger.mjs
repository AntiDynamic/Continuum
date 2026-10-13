import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export function normalizeResponseLedger(records){
 const seen=new Map();
 for(const row of records){const p=row.payload;if(row.type!=='token_usage_record')continue;if(!p?.response_id)throw new Error('Response identity missing');const old=seen.get(p.response_id);if(old&&JSON.stringify(old)!==JSON.stringify(p))throw new Error('Conflicting response usage');seen.set(p.response_id,p);}
 return [...seen.values()].map((p,i)=>{const u=p.usage;if(!u||!['input_tokens','cached_input_tokens','output_tokens','total_tokens'].every(k=>Number.isSafeInteger(u[k])&&u[k]>=0)||u.cached_input_tokens>u.input_tokens)throw new Error('Invalid response usage');return {responseId:p.response_id,logicalTurnId:p.turn_id,sequence:i+1,rawUsage:u,inputTokens:u.input_tokens,cachedInputTokens:u.cached_input_tokens,uncachedInputTokens:u.input_tokens-u.cached_input_tokens,outputTokens:u.output_tokens,totalTokens:u.total_tokens,activeContextOccupancy:null};});
}
export async function buildUsageLedger(directory,experimentId){
 const native=[];async function visit(p){for(const e of await readdir(p,{withFileTypes:true})){const f=join(p,e.name);if(e.isDirectory())await visit(f);else if(e.name.endsWith('.jsonl'))for(const [index,line] of (await readFile(f,'utf8')).split('\n').entries())if(line)native.push({...JSON.parse(line),evidenceSource:{file:f,line:index+1}});}}await visit(join(directory,'native-rollouts'));
 const trace=(await readFile(join(directory,(await readdir(directory)).find(name=>name.endsWith('-trace.jsonl'))),'utf8')).split('\n').filter(Boolean).map(JSON.parse);
 const usageNotifications=trace.filter(r=>r.method==='thread/tokenUsage/updated').map(r=>({timestamp:r.timestamp,raw:r.parsed.params,activeContextOccupancy:null,modelContextCapacity:r.parsed.params.tokenUsage.modelContextWindow??null}));
 const uniqueNotifications=[...new Map(usageNotifications.map(r=>[JSON.stringify(r.raw),r])).values()];
 const effective=trace.find(r=>r.event==='effective-configuration')?.thread;const config=JSON.parse(await readFile(join(directory,'configuration.json'),'utf8')).configuration;
 const responses=normalizeResponseLedger(native).map(r=>{const n=native.find(n=>n.payload?.response_id===r.responseId);return {...r,experimentId,treatment:'C',contextStrategy:config.contextStrategy??'initial_packet',model:effective?.model??config.model,provider:effective?.modelProvider??null,reasoning:effective?.reasoningEffort??config.reasoningEffort,timestamp:n.timestamp??null,evidenceSource:n.evidenceSource,cumulativeUsage:null};});
 let running={inputTokens:0,cachedInputTokens:0,uncachedInputTokens:0,outputTokens:0,totalTokens:0};for(const r of responses){for(const k of Object.keys(running))running[k]+=r[k];r.cumulativeUsage={...running};}
 const toolEvents=trace.filter(r=>r.method==='item/completed'&&['commandExecution','fileChange','dynamicToolCall','mcpToolCall'].includes(r.parsed?.params?.item?.type)).map(r=>({timestamp:r.timestamp,turnId:r.parsed.params.turnId,item:r.parsed.params.item}));
 const initial=trace.find(r=>r.direction==='client_to_server'&&r.method==='turn/start')?.parsed.params.input??[];
 const duplicateTextHashes=initial.map(i=>({sha256:createHash('sha256').update(i.text??'').digest('hex'),bytes:Buffer.byteLength(i.text??''),characters:[...(i.text??'')].length}));
 return {schemaVersion:'continuum.usage-ledger.v1',experimentId,responses,totals:running,rawUsageNotifications:usageNotifications,uniqueUsageNotifications:uniqueNotifications,duplicateNotifications:usageNotifications.length-uniqueNotifications.length,activeContextOccupancy:null,toolEvents,compactionEvents:trace.filter(r=>r.method==='thread/compact/start'||r.parsed?.params?.item?.type==='contextCompaction'),observableRetryEvents:trace.filter(r=>/retry/i.test(r.method??'')),inputHashes:duplicateTextHashes,measurementLimits:['Model context capacity is not active occupancy.','Cumulative snapshots are not summed.','Cached input is a subset of input, not an additional charge.','No fragment billing attribution or actual credit cost is available.']};
}

export function apiEquivalentTextCost(ledger,rates){
 if(!rates||!['uncachedInputPerMillion','cachedInputPerMillion','outputPerMillion'].every(k=>Number.isFinite(rates[k])&&rates[k]>=0))throw new Error('Invalid pricing evidence');
 if(ledger.responses.some(r=>r.inputTokens>272000||r.rawUsage.cache_write_input_tokens===undefined||r.rawUsage.cache_write_input_tokens!==0))return {usd:null,reason:'Long context or unknown/nonzero cache writes require separate price accounting',actualCodexCreditCost:null};
 return {usd:(ledger.totals.uncachedInputTokens*rates.uncachedInputPerMillion+ledger.totals.cachedInputTokens*rates.cachedInputPerMillion+ledger.totals.outputTokens*rates.outputPerMillion)/1e6,label:'API-equivalent text-token estimate at recorded current rates, not actual Codex credits or historical invoice',rates,actualCodexCreditCost:null};
}
