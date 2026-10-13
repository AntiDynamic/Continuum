import {describe,it,expect} from "vitest";
import {StdioCodexAppServerClient} from "../src/client.js";
import type {CodexRawMessage} from "../src/protocol.js";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {openDatabase} from "@continuum/database";
import {CodexAssistExecutionService} from "../src/assist-execution-service.js";

describe("bounded offline Codex cancellation",()=>{
  it("missing compaction acknowledgement times out without an unhandled completion rejection",async()=>{
    const client=new StdioCodexAppServerClient();await client.start({executable:process.execPath,executableArgs:["-e","process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"],requestTimeoutMs:50,shutdownTimeoutMs:100});
    try{await expect(client.compactThread("stalled")).rejects.toThrow("timed out");}finally{await client.close();}
  });
  it("the real assist timeout interrupts a fake stalled turn, records failure and never retries",async()=>{
    const cwd=await mkdtemp(join(tmpdir(),"continuum-assist-timeout-"));
    try {
      await mkdir(join(cwd,"src"));await writeFile(join(cwd,"src/add.ts"),"export function add(a:number,b:number){return a+b;}\n");
      for(const args of [["init"],["add","."],["-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-m","fixture"]])execFileSync("git",args,{cwd,stdio:"ignore"});
      const cli=fileURLToPath(new URL("../../../apps/cli/dist/main.js",import.meta.url));
      for(const args of [["init","--non-interactive"],["index"]])execFileSync(process.execPath,[cli,...args],{cwd,stdio:"pipe",timeout:10000});
      const fixture=fileURLToPath(new URL("./fixtures/fake-app-server.mjs",import.meta.url));
      await expect(new CodexAssistExecutionService().runAssist({cwd,task:"Fix add",timeoutMs:2000,model:"gpt-5.6-luna",reasoningEffort:"low",durableMemory:true,contextEnabled:false,persistentSession:true,process:{executable:process.execPath,executableArgs:[fixture],env:{...process.env,FAKE_CODEX_SCENARIO:"stalled-turn"},shutdownTimeoutMs:100}})).rejects.toThrow("timed out");
      const db=openDatabase(join(cwd,".continuum/continuum.db"));try {
        const methods=db.prepare("SELECT method FROM codex_raw_events WHERE direction='client_to_server'").all() as {method:string}[];
        expect(methods.filter(row=>row.method==="turn/start")).toHaveLength(1);expect(methods.some(row=>row.method==="turn/interrupt")).toBe(true);
        expect(db.prepare("SELECT status FROM codex_executions").get()).toMatchObject({status:"failed"});
      }finally{db.close();}
    }finally{await rm(cwd,{recursive:true,force:true});}
  },15000);
  it("requests graceful interruption and closes a stalled generation without retry",async()=>{
    const raw:CodexRawMessage[]=[];
    const code=`const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const x=JSON.parse(line);if(x.method==='turn/start')console.log(JSON.stringify({id:x.id,result:{turn:{id:'stalled',status:'inProgress'}}}));if(x.method==='turn/interrupt')console.log(JSON.stringify({id:x.id,result:{}}));});rl.on('close',()=>process.exit(0));`;
    const client=new StdioCodexAppServerClient();
    await client.start({executable:process.execPath,executableArgs:["-e",code],requestTimeoutMs:2000,shutdownTimeoutMs:100,onRawMessage:m=>{raw.push(m);}});
    try{await client.startTurn({threadId:"t",task:"stalled"});await new Promise(r=>setTimeout(r,50));await client.interruptTurn("t","stalled");}finally{await client.close();}
    expect(raw.filter(m=>m.direction==="client_to_server"&&m.method==="turn/start")).toHaveLength(1);
    expect(raw.some(m=>m.method==="turn/interrupt")).toBe(true);
  });
  it("kills a process that ignores EOF, interruption and SIGTERM",async()=>{
    const raw:CodexRawMessage[]=[];const code=`process.on('SIGTERM',()=>{});process.stdin.resume();process.stdout.write(JSON.stringify({method:'ready'})+'\\n');setInterval(()=>{},1000);`;
    const client=new StdioCodexAppServerClient();let ready!:()=>void;const started=new Promise<void>(r=>{ready=r;});
    await client.start({executable:process.execPath,executableArgs:["-e",code],requestTimeoutMs:50,shutdownTimeoutMs:100,terminateProcessGroup:true,onRawMessage:m=>{raw.push(m);if(m.method==="ready")ready();}});
    await started;await expect(client.interruptTurn("t","stalled")).rejects.toThrow("timed out");
    const before=Date.now();await client.close();expect(Date.now()-before).toBeLessThan(1500);
    const exit=raw.find(m=>m.method==="process/exited");expect(exit?.parsed).toBeTruthy();
  });
  it("stops excessive process output without claiming a provider output-token cap",async()=>{
    let fatal:Error|undefined;
    const client=new StdioCodexAppServerClient();
    await client.start({executable:process.execPath,executableArgs:["-e","process.stdout.write('x'.repeat(10000));setInterval(()=>{},1000)"],maximumOutputBytes:100,shutdownTimeoutMs:100,onFatalError:e=>{fatal=e;}});
    await new Promise(r=>setTimeout(r,100));await client.close();expect(fatal?.message).toContain("not a provider token cap");
  });
});
