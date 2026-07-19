import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioCodexAppServerClient, CodexIntegrationError } from "../src/index.js";
import type { CodexRawMessage } from "../src/protocol.js";

const fixture=join(fileURLToPath(new URL(".",import.meta.url)),"fixtures","fake-app-server.mjs");
const clients:StdioCodexAppServerClient[]=[];
afterEach(async()=>{await Promise.all(clients.splice(0).map((client)=>client.close().catch(()=>undefined)));});

function make(scenario="normal",callbacks:{raw?:CodexRawMessage[];notifications?:string[];approvals?:string[]}={}):StdioCodexAppServerClient{
  const client=new StdioCodexAppServerClient();clients.push(client);
  void client.start({executable:process.execPath,executableArgs:[fixture],env:{...process.env,FAKE_CODEX_SCENARIO:scenario},requestTimeoutMs:2000,onRawMessage:(message)=>{callbacks.raw?.push(message);},onNotification:(method)=>{callbacks.notifications?.push(method);},onServerRequest:async(request)=>{callbacks.approvals?.push(request.method);return{decision:"decline"};}});
  return client;
}

describe("Codex App Server JSONL client",()=>{
  it("correlates out-of-order responses and keeps stderr separate",async()=>{
    const raw:CodexRawMessage[]=[];const client=make("out-of-order",{raw});
    const [server,account]=await Promise.all([client.initialize(),client.readAccount()]);
    expect(server.userAgent).toContain("0.133.0");expect(account).toMatchObject({authenticated:true,mode:"chatgpt"});
    expect(raw.some((message)=>message.direction==="server_stderr"&&message.raw.includes("separate"))).toBe(true);
    expect(raw.filter((message)=>message.category==="response").map((message)=>message.requestId)).toEqual(expect.arrayContaining([1,2]));
  });

  it("handles notifications, malformed lines, approvals, usage, diff and graceful shutdown",async()=>{
    const raw:CodexRawMessage[]=[];const notifications:string[]=[];const approvals:string[]=[];const client=make("malformed",{raw,notifications,approvals});
    await client.initialize();await client.readAccount();const thread=await client.startThread({cwd:process.cwd()});await client.startTurn({threadId:thread.id,task:"Only the original task"});
    await new Promise((resolve)=>setTimeout(resolve,100));
    expect(approvals).toEqual(["item/commandExecution/requestApproval"]);
    const approvalRequest=raw.findIndex((message)=>message.category==="server_request");const approvalDecision=raw.findIndex((message)=>message.direction==="client_to_server"&&message.category==="response"&&message.requestId===900);expect(approvalRequest).toBeGreaterThanOrEqual(0);expect(approvalDecision).toBeGreaterThan(approvalRequest);expect(notifications).toContain("turn/completed");expect(notifications).toContain("unknown/futureNotification");expect(notifications).toContain("protocol/malformed");
    expect(raw.some((message)=>message.method==="thread/tokenUsage/updated")).toBe(true);expect(raw.some((message)=>message.method==="turn/diff/updated")).toBe(true);expect(raw.some((message)=>message.category==="malformed")).toBe(true);
    await client.close();
  });

  it("rejects pending requests when the child exits unexpectedly",async()=>{
    const client=make("unexpected-exit");await client.initialize();await client.readAccount();const thread=await client.startThread({cwd:process.cwd()});await client.startTurn({threadId:thread.id,task:"exit"});
    await expect(client.resumeThread(thread.id)).rejects.toMatchObject({code:"UNEXPECTED_PROCESS_EXIT"} satisfies Partial<CodexIntegrationError>);
  });

  it("times out unsupported or missing responses deterministically",async()=>{
    const client=new StdioCodexAppServerClient();clients.push(client);await client.start({executable:process.execPath,executableArgs:[fixture],env:{...process.env,FAKE_CODEX_SCENARIO:"unexpected-exit"},requestTimeoutMs:500});
    await client.initialize();await client.readAccount();const thread=await client.startThread({cwd:process.cwd()});await client.startTurn({threadId:thread.id,task:"timeout"});
    await expect(client.resumeThread(thread.id)).rejects.toBeInstanceOf(CodexIntegrationError);
  });

  it("opts into experimental API explicitly and fingerprints the generated stable schema",async()=>{
    const raw:CodexRawMessage[]=[];const client=make("normal",{raw});await client.initialize({experimentalApi:true});
    const initialize=raw.find(message=>message.method==="initialize");expect((initialize?.parsed as any).params.capabilities).toEqual({experimentalApi:true});
    const { stableSchemaFingerprint }=await import("../src/index.js");expect(stableSchemaFingerprint()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("propagates raw-event persistence failures instead of silently continuing",async()=>{
    const client=new StdioCodexAppServerClient();clients.push(client);let fatal:Error|undefined;
    await client.start({executable:process.execPath,executableArgs:[fixture],env:{...process.env,FAKE_CODEX_SCENARIO:"normal"},requestTimeoutMs:2000,onRawMessage:()=>{throw new Error("ledger unavailable");},onFatalError:error=>{fatal=error;}});
    await expect(client.initialize()).rejects.toThrow("ledger unavailable");expect(fatal?.message).toBe("ledger unavailable");
  });

});
