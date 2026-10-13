#!/usr/bin/env node
// Metadata only: this script never starts a thread, turn, compaction, or model inference.
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
const child=spawn("codex",["app-server","--listen","stdio://"],{stdio:["pipe","pipe","ignore"]});
const requested="GPT-5.6 Luna";let buffer="",done=false,inspection=null,codexHome=null;
const send=value=>child.stdin.write(JSON.stringify(value)+"\n");
const finish=async(result)=>{if(done)return;done=true;clearTimeout(timer);const output={requested,...result,inferenceRequests:0,availability:"model/list metadata does not prove an inference will be accepted",inspectedAt:new Date().toISOString()};const flag=process.argv.indexOf("--output");if(flag>=0)await writeFile(process.argv[flag+1],JSON.stringify(output,null,2)+"\n");console.log(JSON.stringify(output,null,2));child.stdin.end();setTimeout(()=>child.kill(),500).unref();};
const timer=setTimeout(()=>{void finish({error:"metadata request timed out"});},15000);
child.on("error",error=>{void finish({error:error.message});});
send({id:1,method:"initialize",params:{clientInfo:{name:"continuum-model-inspection",version:"0.1.0"},capabilities:{experimentalApi:true}}});
child.stdout.on("data",chunk=>{buffer+=chunk;let newline;while((newline=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);let message;try{message=JSON.parse(line);}catch{continue;}
  if(message.id===1){if(message.error){void finish({error:message.error.message});continue;}codexHome=message.result?.codexHome??null;send({method:"initialized"});send({id:2,method:"model/list",params:{includeHidden:true,limit:100}});}
  if(message.id===2){const models=message.result?.data??[],matches=models.filter(model=>/5[.-]6.*luna/i.test(model.model??model.id)||/5[.-]6.*luna/i.test(model.displayName??""));inspection={matches:matches.map(model=>({id:model.id,model:model.model,displayName:model.displayName,supportedReasoningEfforts:model.supportedReasoningEfforts})),listedModels:models.map(model=>model.model??model.id),nextCursor:message.result?.nextCursor??null,error:message.error?.message??null};send({id:3,method:"config/read",params:{includeLayers:false}});}
  if(message.id===3){inspection={...inspection,codexHome,configuredMcpServers:Object.keys(message.result?.config?.mcp_servers??{}),configMetadataAvailable:!!message.result?.config,configError:message.error?.message??null};send({id:4,method:"account/read",params:{refreshToken:false}});}
  if(message.id===4){void finish({...inspection,authenticationMetadataAvailable:!!message.result,authenticated:message.result?.account!==null&&!!message.result?.account||message.result?.requiresOpenaiAuth===false,requiresOpenaiAuth:message.result?.requiresOpenaiAuth??null,authenticationMode:message.result?.account?.type??null,accountError:message.error?.message??null});}
}});
