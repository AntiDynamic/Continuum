/* global process, setTimeout */
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const send=(value)=>process.stdout.write(JSON.stringify(value)+"\n");
const scenario=process.env.FAKE_CODEX_SCENARIO??"normal";
let cwd=process.cwd();
let approvalRequestId=900;
const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
process.stderr.write("fake app-server stderr is separate\n");

function completeTurn(){
  send({method:"unknown/futureNotification",params:{optionalField:null}});
  if(scenario==="malformed")process.stdout.write("{not-json}\n");
  send({method:"item/started",params:{threadId:"thread-fixture",turnId:"turn-fixture",startedAtMs:Date.now(),item:{type:"commandExecution",id:"command-1",command:"pnpm test",cwd,processId:null,source:"agent",status:"inProgress",commandActions:[],aggregatedOutput:null,exitCode:null,durationMs:null}}});
  send({method:"item/completed",params:{threadId:"thread-fixture",turnId:"turn-fixture",completedAtMs:Date.now(),item:{type:"commandExecution",id:"command-1",command:"pnpm test",cwd,processId:null,source:"agent",status:"completed",commandActions:[],aggregatedOutput:"1 passed",exitCode:0,durationMs:42}}});
  if(process.env.FAKE_CODEX_APPLY_PATCH==="1")writeFileSync(join(cwd,"src","add.ts"),"export const add = (a: number, b: number) => a + b;\n");
  const diff="diff --git a/src/add.ts b/src/add.ts\n--- a/src/add.ts\n+++ b/src/add.ts\n@@ -1 +1 @@\n-export const add = () => 0;\n+export const add = (a: number, b: number) => a + b;\n";
  send({method:"item/completed",params:{threadId:"thread-fixture",turnId:"turn-fixture",completedAtMs:Date.now(),item:{type:"fileChange",id:"file-1",changes:[{path:"src/add.ts",kind:"update",diff}],status:"completed"}}});
  send({method:"turn/diff/updated",params:{threadId:"thread-fixture",turnId:"turn-fixture",diff}});
  send({method:"thread/tokenUsage/updated",params:{threadId:"thread-fixture",turnId:"turn-fixture",tokenUsage:{total:{totalTokens:150,inputTokens:100,cachedInputTokens:20,outputTokens:50,reasoningOutputTokens:10},last:{totalTokens:60,inputTokens:40,cachedInputTokens:10,outputTokens:20,reasoningOutputTokens:5},modelContextWindow:200000}}});
  send({method:"item/completed",params:{threadId:"thread-fixture",turnId:"turn-fixture",completedAtMs:Date.now(),item:{type:"agentMessage",id:"message-1",text:"Fixed add and tests pass.",phase:"final_answer",memoryCitation:null}}});
  send({method:"turn/completed",params:{threadId:"thread-fixture",turn:{id:"turn-fixture",items:[],itemsView:{type:"full"},status:"completed",error:null,startedAt:1,completedAt:2,durationMs:100}}});
}

rl.on("line",line=>{
  let message;try{message=JSON.parse(line)}catch{return}
  if(message.method==="initialize")setTimeout(()=>send({id:message.id,result:{userAgent:"codex-cli/0.133.0 fixture",codexHome:cwd,platformFamily:"windows",platformOs:"windows"}}),scenario==="out-of-order"?25:0);
  else if(message.method==="account/read")setTimeout(()=>send({id:message.id,result:scenario==="unauthenticated"?{account:null,requiresOpenaiAuth:true}:{account:{type:"chatgpt",email:"redacted@example.invalid",planType:"unknown"},requiresOpenaiAuth:true}}),1);
  else if(message.method==="thread/start"){
    cwd=message.params.cwd;send({method:"thread/started",params:{thread:{id:"thread-fixture"}}});
    send({id:message.id,result:{thread:{id:"thread-fixture",cwd,turns:[]},model:message.params.model??"gpt-fixture",modelProvider:"openai",cwd,instructionSources:[],approvalPolicy:message.params.approvalPolicy,approvalsReviewer:"user",sandbox:{type:"workspaceWrite"},reasoningEffort:null}});
  }else if(message.method==="thread/resume"){if(scenario!=="unexpected-exit")send({id:message.id,result:{thread:{id:message.params.threadId,cwd,turns:[]},model:"gpt-fixture",modelProvider:"openai",cwd}});}
  else if(message.method==="turn/start"){
    send({id:message.id,result:{turn:{id:"turn-fixture",status:"inProgress"}}});
    send({method:"turn/started",params:{threadId:"thread-fixture",turn:{id:"turn-fixture"}}});
    if(scenario==="unexpected-exit")setTimeout(()=>process.exit(23),5);
    else{send({id:approvalRequestId,method:scenario==="unsupported-request"?"unknown/request":"item/commandExecution/requestApproval",params:{threadId:"thread-fixture",turnId:"turn-fixture",itemId:"approval-1",startedAtMs:Date.now(),command:"pnpm test",cwd,reason:"run tests"}});setTimeout(completeTurn,20);}
  }else if(message.method==="turn/interrupt"){send({id:message.id,result:{}});send({method:"turn/completed",params:{threadId:"thread-fixture",turn:{id:message.params.turnId,status:"interrupted",items:[],itemsView:{type:"full"},error:null,startedAt:1,completedAt:2,durationMs:1}}});}
  else if(message.id===approvalRequestId)send({method:"serverRequest/resolved",params:{threadId:"thread-fixture",requestId:approvalRequestId}});
});
rl.on("close",()=>process.exit(0));
