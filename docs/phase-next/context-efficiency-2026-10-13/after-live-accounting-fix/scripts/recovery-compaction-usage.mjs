import {readFile,readdir} from 'node:fs/promises';import {join,relative} from 'node:path';
import {normalizeResponseLedger} from './recovery-usage-ledger.mjs';
/** Only the isolated task's native history; no network, model or tokenizer. */
export async function readNativeCompactionUsage(home,threadId){
 const matches=[];async function visit(dir){for(const e of await readdir(dir,{withFileTypes:true})){const file=join(dir,e.name);if(e.isDirectory())await visit(file);else if(e.name.endsWith('.jsonl')){const lines=(await readFile(file,'utf8')).split('\n');for(let i=0;i<lines.length;i++){if(!lines[i])continue;const row=JSON.parse(lines[i]);if(row.type!=='compacted')continue;const record=row.payload?.latest_token_usage_record;if(record?.thread_id!==threadId)continue;if(record.response_id!==row.payload.compaction_response_id)throw new Error('Compaction response identity mismatch');const usage=normalizeResponseLedger([{type:'token_usage_record',payload:record}])[0];matches.push({...usage,threadId,evidenceSource:{file,line:i+1,exportRelativePath:join("native-rollouts",relative(join(home,"sessions"),file))}});}}}}await visit(join(home,'sessions'));
 if(matches.length!==1)throw new Error('Exactly one independently identifiable native compaction usage record required');return matches[0];
}
export function reconcileCompactionUsage(usage,before,after){
 if(!usage||!before||!after)throw new Error('Compaction usage accounting unavailable');
 const fields=['inputTokens','cachedInputTokens','outputTokens','totalTokens'];
 if(fields.some(k=>!Number.isSafeInteger(usage[k])||usage[k]<0||!Number.isSafeInteger(before[k])||!Number.isSafeInteger(after[k])))throw new Error('Invalid compaction accounting');
 const delta=Object.fromEntries(fields.map(k=>[k,after[k]-before[k]]));
 if(fields.every(k=>delta[k]===usage[k]))return {scope:'included_in_thread_notifications',offset:Object.fromEntries(fields.map(k=>[k,0]))};
 if(fields.every(k=>delta[k]===0))return {scope:'excluded_from_thread_notifications',offset:Object.fromEntries(fields.map(k=>[k,usage[k]]))};
 throw new Error('Ambiguous compaction attribution; continuation blocked');
}
