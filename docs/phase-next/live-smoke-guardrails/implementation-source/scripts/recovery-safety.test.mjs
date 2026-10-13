import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {retryPreInference,classifyRetry,SmokeSafety,assertEffective,hostRetryAssessment,assertHostRetries,acquireExperimentLock,smokeFeatureOverrides} from "./recovery-safety.mjs";

const transient=(classification="connection",extras={})=>Object.assign(new Error("fixture transient"),{classification,confirmedNoBillableGeneration:true,confirmedNotCompleted:true,documentedSafeRetry:true,...extras});
const thread={id:"thread-1",model:"gpt-5.6-luna",modelProvider:"openai",reasoningEffort:"low"};
const usage=n=>({threadId:thread.id,tokenUsage:{total:{inputTokens:n-20,cachedInputTokens:5,outputTokens:20,totalTokens:n}}});
const evidence={origin:"host",method:"item/completed",threadId:thread.id,itemType:"contextCompaction",itemId:"compact-1"};
function firstFinished(){const guard=new SmokeSafety();guard.effective(thread);guard.begin("turn");guard.observeUsage(usage(100));guard.finish("turn",true);return guard;}

test("safe metadata transient retries once, then succeeds and logs attempts",async()=>{
  const events=[],delays=[];let attempts=0;
  const result=await retryPreInference(()=>{if(++attempts===1)throw transient();return "ok";},{name:"model/list",log:e=>events.push(e),sleep:async ms=>delays.push(ms)});
  assert.equal(result,"ok");assert.equal(attempts,2);assert.deepEqual(delays,[2000]);assert.equal(events[0].classification,"connection");assert.equal(events[1].outcome,"success");
});
test("retry exhaustion is four total metadata attempts with 2/4/8 second backoff",async()=>{
  let attempts=0;const delays=[];
  await assert.rejects(retryPreInference(()=>{attempts++;throw transient();},{name:"initialize",sleep:async ms=>delays.push(ms)}));
  assert.equal(attempts,4);assert.deepEqual(delays,[2000,4000,8000]);
});
test("authentication, configuration, credit, validation and behavior failures never retry",async()=>{
  for(const classification of ["authentication","authorization","configuration","credits","validation","behavior","safety","timeout"]){let attempts=0;await assert.rejects(retryPreInference(()=>{attempts++;throw transient(classification);},{name:"config/read",sleep:()=>assert.fail("must not back off")}));assert.equal(attempts,1);}
});
test("rate limit respects provider permission and Retry-After without extending deadline",async()=>{
  assert.equal(classifyRetry(transient("rate-limit")).retry,false);const delays=[];let attempts=0;
  await retryPreInference(()=>{if(++attempts===1)throw transient("rate-limit",{providerPermitsRetry:true,retryAfterMs:6000});return true;},{name:"account/read",sleep:async ms=>delays.push(ms)});
  assert.deepEqual(delays,[6000]);
  await assert.rejects(retryPreInference(()=>{throw transient("rate-limit",{providerPermitsRetry:true,retryAfterMs:60000});},{name:"account/read",sleep:()=>assert.fail("outside deadline")}));
});
test("ambiguous completion or billing prevents retry, and inference methods cannot use retry loop",async()=>{
  assert.equal(classifyRetry(transient("connection",{confirmedNoBillableGeneration:false})).retry,false);
  assert.equal(classifyRetry(transient("server",{confirmedNotCompleted:false})).retry,false);
  for(const name of ["turn/start","thread/compact/start","benchmark"]){await assert.rejects(retryPreInference(()=>assert.fail("must never execute"),{name}));}
});
test("missing telemetry blocks compaction and further generation",()=>{
  const guard=new SmokeSafety();guard.effective(thread);guard.begin("turn");guard.finish("turn",true);
  assert.throws(()=>guard.begin("compaction"),/Usage unavailable/);assert.throws(()=>guard.begin("turn"),/Usage unavailable/);
  assert.throws(()=>guard.observeUsage({threadId:thread.id,tokenUsage:{total:{totalTokens:100}}}),/mandatory/);
});
test("effective model, provider, reasoning and thread drift are rejected",()=>{
  for(const bad of [{model:"other"},{modelProvider:"other"},{reasoningEffort:"high"},{id:"other"}])assert.throws(()=>assertEffective({...thread,...bad},thread.id),/drift/);
});
test("unexpected third turn and second compaction are blocked",()=>{
  const guard=firstFinished();guard.begin("compaction");guard.observeUsage(usage(200));guard.finish("compaction",true,evidence);
  guard.begin("turn",{recovery:{renderedContent:"original",originalRequirementsVerified:true}});guard.finish("turn",true);
  assert.throws(()=>guard.begin("turn"),/Additional/);assert.throws(()=>guard.begin("compaction"),/Unexpected/);
});
test("concurrent operations and parallel experiment lock acquisition fail",async()=>{
  const guard=new SmokeSafety();guard.effective(thread);guard.begin("turn");assert.throws(()=>guard.begin("turn"),/concurrent/);
  const path=await mkdtemp(join(tmpdir(),"continuum-lock-test-"));try{await acquireExperimentLock(join(path,"once.lock"));await assert.rejects(acquireExperimentLock(join(path,"once.lock")),{code:"EEXIST"});}finally{await rm(path,{recursive:true,force:true});}
});
test("compaction failure or simulated evidence stops continuation",()=>{
  const guard=firstFinished();guard.begin("compaction");assert.throws(()=>guard.finish("compaction",false),/failed/);assert.throws(()=>guard.begin("turn"),/Stopped/);
  const simulated=firstFinished();simulated.begin("compaction");assert.throws(()=>simulated.finish("compaction",true,{...evidence,origin:"mock"}),/protocol/);
});
test("recovery injection failure, missing originals and incomplete packet block second turn",()=>{
  const guard=firstFinished();guard.begin("compaction");guard.observeUsage(usage(200));guard.finish("compaction",true,evidence);
  for(const recovery of [null,{renderedContent:"text"},{renderedContent:"text",originalRequirementsVerified:true,incomplete:true}])assert.throws(()=>guard.begin("turn",{recovery}),/Recovery injection/);
});
test("reported 20000-token threshold stops before another operation; no billing cap claimed",()=>{
  const guard=firstFinished();assert.throws(()=>guard.observeUsage(usage(20000)),/not a billing cap/);assert.throws(()=>guard.begin("compaction"),/Stopped/);
});
test("installed provider retry limitation and unknown host versions fail closed",()=>{
  for(const version of ["0.162.1","future",null])assert.throws(()=>assertHostRetries(hostRetryAssessment(version)),/Uncontrolled host retries/);
  assert.match(hostRetryAssessment("0.162.1").reason,/ignores overrides/);
});
test("host multi-agent tools, goals and unbounded connection retries are explicitly disabled",()=>{
  assert.deepEqual(smokeFeatureOverrides,{"features.multi_agent":false,"features.multi_agent_v2":false,"features.multi_agent_v2_dynamic_tools":false,"features.goals":false,"features.unbounded_connection_retries":false});
});
test("compaction without reported usage cannot authorize continuation",()=>{
  const guard=firstFinished();guard.begin("compaction");guard.finish("compaction",true,evidence);
  assert.throws(()=>guard.begin("turn",{recovery:{renderedContent:"original",originalRequirementsVerified:true}}),/Compaction usage unavailable/);
});
test("raw protocol observer blocks omitted recovery before second request is written",()=>{
  const guard=firstFinished();guard.begin("compaction");guard.observeUsage(usage(200));guard.finish("compaction",true,evidence);
  assert.throws(()=>guard.observeRaw({direction:"client_to_server",parsed:{id:7,method:"turn/start",params:{input:[{text:"continue"}]}}},"critical original requirement"),/Recovery injection/);
  assert.throws(()=>guard.observeRaw({direction:"server_to_client",parsed:{method:"model/rerouted",params:{toModel:"other"}}},"original"),/rerouting/);
});
