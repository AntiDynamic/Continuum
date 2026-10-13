import {open} from "node:fs/promises";

export const smokeLimits=Object.freeze({model:"gpt-5.6-luna",provider:"openai",reasoning:"low",turns:2,compactions:1,reportedTokens:20000,timeoutMs:60000,compactionTimeoutMs:30000,graceMs:5000});
export const smokeFeatureOverrides=Object.freeze({"features.multi_agent":false,"features.multi_agent_v2":false,"features.multi_agent_v2_dynamic_tools":false,"features.goals":false,"features.unbounded_connection_retries":false});

// Evidence from the matching release, not from configurable values echoed by config/read.
export function hostRetryAssessment(version) {
  return {version,verified:false,controlled:false,reason:version==="0.162.1"?
    "Codex 0.162.1 merge_configured_model_providers ignores overrides of built-in openai (entry.or_insert); default HTTP/stream retries and separate unauthorized recovery cannot be disabled through those overrides.":
    "No reviewed proof that all inference retry paths are controlled for this host version.",
  sources:["https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/model-provider-info/src/lib.rs#L699","https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/client.rs#L1795","https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/responses_retry.rs#L99"]};
}

export function assertHostRetries(assessment,acceptedKnownLimitation=false) {
  if(acceptedKnownLimitation&&assessment?.version==="0.162.1")return;
  if(assessment?.verified!==true||assessment?.controlled!==true)throw new Error("Uncontrolled host retries: "+(assessment?.reason??"missing host assessment"));
}

export function assertEffective(thread,expectedThreadId) {
  if(thread?.model!==smokeLimits.model||thread?.modelProvider!==smokeLimits.provider||thread?.reasoningEffort!==smokeLimits.reasoning||expectedThreadId&&thread.id!==expectedThreadId)throw new Error("Effective model, provider, reasoning or thread drift.");
}

export function classifyRetry(error) {
  const forbidden=new Set(["authentication","authorization","configuration","credits","validation","behavior","safety","ambiguous","timeout"]);
  if(forbidden.has(error?.classification))return {retry:false,classification:error.classification};
  const safe=error?.confirmedNoBillableGeneration===true&&error?.confirmedNotCompleted===true;
  const allowed=error?.documentedSafeRetry===true&&["connection","server","rate-limit"].includes(error?.classification);
  return {retry:safe&&allowed&&(error.classification!=="rate-limit"||error.providerPermitsRetry===true),classification:allowed&&safe?error.classification:"ambiguous"};
}

// Never wrap turn/start, compaction or the whole experiment in this retry loop.
// Only pre-inference metadata operations can be resubmitted by Continuum.
export async function retryPreInference(operation,{name,log,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),deadlineMs=30000,now=Date.now}={}) {
  if(!["initialize","model/list","account/read","config/read"].includes(name))throw new Error("Inference operations cannot be retried by Continuum.");
  const deadline=now()+deadlineMs;
  for(let attempt=1;attempt<=4;attempt++) {
    try {const result=await operation(attempt);await log?.({operation:name,attempt,outcome:"success",usage:null});return result;}
    catch(error) {
      const decision=classifyRetry(error);
      const delay=Math.max(2000*2**(attempt-1),Number.isFinite(error.retryAfterMs)?Math.max(0,error.retryAfterMs):0);
      const retry=decision.retry&&attempt<4&&now()+delay<deadline;
      await log?.({operation:name,attempt,outcome:"error",classification:decision.classification,error:String(error),retry,delayMs:retry?delay:null,usage:error.usage??null});
      if(!retry)throw error;
      await sleep(delay);
    }
  }
}

export async function acquireExperimentLock(path) {
  const handle=await open(path,"wx",0o600);
  await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString(),policy:"one experiment; lock is never automatically cleared"})+"\n");
  await handle.close();
}

export class SmokeSafety {
  turns=0;compactions=0;active=null;threadId=null;usage=null;compactionComplete=false;stopped=false;
  usageObservations=0;compactionUsageStart=0;compactionTurnId=null;
  constructor(log=()=>{},{reportedTokens=smokeLimits.reportedTokens}={}) {if(!Number.isSafeInteger(reportedTokens)||reportedTokens<1||reportedTokens>85000)throw new Error("Invalid provider usage budget.");this.log=log;this.reportedTokens=reportedTokens;}
  requests=new Map();
  observeRaw(message,originalRequirements) {
    const parsed=message.parsed;
    if(message.direction==="client_to_server"&&parsed?.method) {
      this.requests.set(parsed.id,parsed.method);
      if(parsed.method==="turn/start") {
        const rendered=parsed.params?.input?.map(item=>item.text??"").join("\n")??"";
        this.begin("turn",{recovery:{renderedContent:rendered,incomplete:false,originalRequirementsVerified:rendered.includes(originalRequirements)}});
      } else if(parsed.method==="thread/compact/start")this.begin("compaction");
    }
    if(message.direction==="server_to_client"&&parsed?.id!==undefined) {
      const method=this.requests.get(parsed.id);
      if(["thread/start","thread/resume"].includes(method)&&parsed.result)this.effective({...parsed.result,id:parsed.result.thread?.id});
    }
    if(message.direction==="server_to_client"&&parsed?.method) {
      const {method,params}=parsed;
      if(method==="model/rerouted"){this.stopped=true;throw new Error("Provider model rerouting blocked.");}
      if(method==="thread/tokenUsage/updated"){
        try{this.observeUsage(params);}catch(error){if(error.code!=="REPORTED_TOKEN_STOP")throw error;}
      }
      if(method==="turn/completed"&&this.active==="turn")this.finish("turn",params?.turn?.status==="completed",params);
      if(method==="turn/completed"&&(this.active==="compaction"||params?.turn?.id===this.compactionTurnId)&&params?.turn?.status!=="completed"){this.stopped=true;throw new Error("Compaction turn failed.");}
      if(method==="item/completed"&&params?.item?.type==="contextCompaction")this.finish("compaction",true,{origin:"host",method,threadId:params.threadId,itemType:params.item.type,itemId:params.item.id,turnId:params.turnId});
    }
  }
  effective(thread) {assertEffective(thread,this.threadId);this.threadId=thread.id;this.log({event:"effective-configuration",thread});}
  begin(kind,{recovery}={}) {
    if(this.stopped||this.active)throw new Error("Stopped or concurrent smoke operation.");
    if(!this.threadId)throw new Error("Effective configuration not verified.");
    if(kind==="turn") {
      if(this.turns>=2)throw new Error("Additional generation request blocked.");
      if(this.turns>0) {
        this.requireUsage();
        if(!this.compactionComplete)throw new Error("Compaction failed or unverified.");
        if(this.usageObservations<=this.compactionUsageStart)throw new Error("Compaction usage unavailable; continuation blocked.");
        if(!recovery||recovery.incomplete||!recovery.renderedContent||recovery.originalRequirementsVerified!==true)throw new Error("Recovery injection failed verification.");
      }
      this.turns++;
    } else if(kind==="compaction") {
      if(this.turns!==1||this.compactions>=1)throw new Error("Unexpected compaction request.");
      this.requireUsage();this.compactions++;this.compactionUsageStart=this.usageObservations;
    } else throw new Error("Invalid operation.");
    this.active=kind;this.log({event:"operation-start",kind,attempt:1,usage:this.usage});
  }
  observeUsage(params) {
    if(params?.threadId!==this.threadId)throw new Error("Usage belongs to another thread.");
    const total=params?.tokenUsage?.total;
    if(!total||!["inputTokens","cachedInputTokens","outputTokens","totalTokens"].every(key=>Number.isSafeInteger(total[key])&&total[key]>=0))throw new Error("Missing mandatory usage fields.");
    if(this.usage&&total.totalTokens<this.usage.totalTokens)throw new Error("Usage counter regressed.");
    this.usage={...total};this.usageObservations++;this.log({event:"usage",kind:this.active,usage:this.usage});
    if(total.totalTokens>=this.reportedTokens){this.stopped=true;throw Object.assign(new Error("Reported token stopping threshold reached; not a billing cap."),{code:"REPORTED_TOKEN_STOP"});}
  }
  requireUsage() {if(!this.usage||this.usage.totalTokens>=this.reportedTokens)throw new Error("Usage unavailable or stopping threshold reached.");}
  finish(kind,success,evidence) {
    if(kind!==this.active)throw new Error("Unexpected operation completion.");
    this.log({event:"operation-finish",kind,success,evidence,usage:this.usage});this.active=null;
    if(!success){this.stopped=true;throw new Error(kind+" failed; experiment stopped.");}
    if(kind==="compaction") {
      if(evidence?.origin!=="host"||evidence?.method!=="item/completed"||evidence?.itemType!=="contextCompaction"||evidence.threadId!==this.threadId||!evidence.itemId){this.stopped=true;throw new Error("Compaction protocol evidence missing.");}
      this.compactionComplete=true;
      this.compactionTurnId=evidence.turnId;
    }
  }
}
