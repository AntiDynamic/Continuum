import {spawn} from "node:child_process";

/** Protocol V1 from Codex 0.162.1: length-prefixed (u32 LE) JSON, not App Server JSONL.
 * This launches the real local helper and evaluates JavaScript; no model or network request. */
export async function runHelperOperation(isolated,{source="text('continuum-helper-ok:'+(6*7));",timeoutMs=5000,onSpawn}={}) {
  const child=spawn(isolated.executable,[...isolated.commandPrefix,"--unshare-net","--",isolated.runtime.helper],{cwd:isolated.cwd,env:isolated.env,stdio:["pipe","pipe","pipe"],detached:true});
  onSpawn?.(child.pid);
  const trace=[];let buffer=Buffer.alloc(0),stderr="",nextId=1,waiting=null,exited=false;
  const exit=new Promise(resolve=>child.once("exit",(code,signal)=>{exited=true;resolve({code,signal});if(waiting)waiting.reject(new Error("Helper exited before response."));}));
  child.on("error",error=>waiting?.reject(error));
  child.stderr.on("data",chunk=>{stderr+=chunk;if(stderr.length>65536){waiting?.reject(new Error("Helper stderr exceeded limit."));child.kill("SIGKILL");}});
  child.stdout.on("data",chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    try {
      while(buffer.length>=4){const length=buffer.readUInt32LE();if(length>1024*1024)throw new Error("Helper frame exceeded preflight limit.");if(buffer.length<length+4)break;const value=JSON.parse(buffer.subarray(4,length+4).toString());buffer=buffer.subarray(length+4);trace.push({direction:"host_to_client",value});
        if(value.type==="delegate/request")throw new Error("Preflight helper attempted an unexpected nested tool operation.");
        if(waiting&&waiting.match(value)){const pending=waiting;waiting=null;clearTimeout(pending.timer);pending.resolve(value);}
      }
    }catch(error){waiting?.reject(error);}
  });
  const exchange=(value,match)=>new Promise((resolve,reject)=>{
    if(waiting)return reject(new Error("Concurrent helper preflight requests are forbidden."));
    const timer=setTimeout(()=>{waiting=null;reject(new Error("Helper operation timed out."));},timeoutMs);
    waiting={resolve,reject:error=>{clearTimeout(timer);waiting=null;reject(error);},match,timer};trace.push({direction:"client_to_host",value});
    const payload=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(4);header.writeUInt32LE(payload.length);
    child.stdin.write(Buffer.concat([header,payload]),error=>{if(error)waiting?.reject(error);});
  });
  let result;
  try {
    const hello=await exchange({type:"connection/hello",supportedVersions:[1],requiredCapabilities:[],optionalCapabilities:[]},v=>v.type==="connection/ready"||v.type==="connection/rejected");
    if(hello.type!=="connection/ready"||hello.selectedVersion!==1)throw new Error("Unsupported code-mode helper handshake.");
    const id=nextId++;const opened=await exchange({type:"operation/request",id,request:{method:"session/open",sessionId:"continuum-offline-preflight"}},v=>v.type==="operation/response"&&v.id===id);
    if(opened.result?.status!=="ok")throw new Error("Helper session open failed.");
    const execId=nextId++;const response=await exchange({type:"operation/request",id:execId,request:{method:"session/execute",sessionId:"continuum-offline-preflight",request:{tool_call_id:"continuum-offline-only",enabled_tools:[],source,yield_time_ms:1000,max_output_tokens:256}}},v=>v.type==="execute/initialResponse"&&v.id===execId);
    const output=response.result?.value?.Result;
    if(response.result?.status!=="ok"||!output||output.error_text)throw new Error("Helper operation failed: "+(output?.error_text??JSON.stringify(response.result)));
    result={output:output.content_items.filter(item=>item.type==="input_text").map(item=>item.text).join("\n"),trace,stderr,inferenceRequests:0};
    const closeId=nextId++;const closed=await exchange({type:"operation/request",id:closeId,request:{method:"session/shutdown",sessionId:"continuum-offline-preflight"}},v=>v.type==="operation/response"&&v.id===closeId);
    if(closed.result?.status!=="ok")throw new Error("Helper session shutdown failed.");
  }catch(error){error.preflightEvidence={trace,stderr,inferenceRequests:0};throw error;}
  finally {
    if(waiting){clearTimeout(waiting.timer);waiting=null;}
    child.stdin.end();
    let timer;const wait=async ms=>{try{return await Promise.race([exit,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),ms);})]);}finally{clearTimeout(timer);}};
    const signal=s=>{try{process.kill(-child.pid,s);}catch(error){if(error.code!=="ESRCH")throw error;}};
    if(!exited&&!await wait(300)){signal("SIGTERM");if(!await wait(300)){signal("SIGKILL");if(!await wait(1000))throw new Error("Helper did not exit after SIGKILL.");}}
    if(!await waitForProcessGroupGone(child.pid,500)){signal("SIGKILL");if(!await waitForProcessGroupGone(child.pid,1000))throw new Error("Helper process group remained after cleanup.");}
    if(result)result.cleanup={exited,pid:child.pid,groupGone:true};
  }
  return result;
}

export function processGroupExists(pid) {
  try{process.kill(-pid,0);return true;}catch(error){if(error.code==="ESRCH")return false;throw error;}
}

export async function waitForProcessGroupGone(pid,timeoutMs) {
  const deadline=Date.now()+timeoutMs;
  while(processGroupExists(pid)){if(Date.now()>=deadline)return false;await new Promise(resolve=>setTimeout(resolve,20));}
  return true;
}
