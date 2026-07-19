import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { CodexIntegrationError } from "./errors.js";
import { detectCodexVersion, resolveCodexExecutable, resolveCodexInvocation } from "./compatibility.js";
import { isRecord } from "./json.js";
import type {
  CodexAccountState, CodexAppServerClient, CodexInitializeOptions, CodexProcessOptions,
  CodexRawMessage, CodexServerInfo, CodexServerRequestContext, CodexThread,
  CodexThreadOptions, CodexTurn, CodexTurnOptions, JsonRpcId, JsonRpcResponse,
} from "./protocol.js";

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const timestamp = (): string => new Date().toISOString();
export class StdioCodexAppServerClient implements CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private options: CodexProcessOptions = {};
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextId = 1;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly stdoutDecoder = new StringDecoder("utf8");
  private readonly stderrDecoder = new StringDecoder("utf8");
  private callbackChain: Promise<void> = Promise.resolve();
  private inboundChain: Promise<void> = Promise.resolve();
  private callbackFailure: Error | null = null;
  private closed = false;
  version: string | null = null;

  async start(options: CodexProcessOptions = {}): Promise<void> {
    if (this.child) return;
    this.options = options;
    const executable = options.executable ?? resolveCodexExecutable();
    const invocation=options.executable?{command:executable,argsPrefix:[]}:resolveCodexInvocation(executable);
    const args = [...invocation.argsPrefix,...(options.executableArgs ?? ["app-server", "--listen", "stdio://"])];
    if (!options.executable) this.version = detectCodexVersion(executable);
    try {
      this.child = spawn(invocation.command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      throw new CodexIntegrationError("APP_SERVER_UNAVAILABLE", "Codex App Server could not be started.", error);
    }
    this.child.stdout.on("data", (chunk: Buffer) => this.consumeStdout(this.stdoutDecoder.write(chunk)));
    this.child.stderr.on("data", (chunk: Buffer) => this.consumeStderr(this.stderrDecoder.write(chunk)));
    this.child.once("error", (error) => this.rejectAll(new CodexIntegrationError("APP_SERVER_UNAVAILABLE", "Codex App Server process failed.", error)));
    this.child.once("exit", (code, signal) => {
      this.flushDecoders();
      const params={ code, signal, expected: this.closed };
      this.enqueueOperation(async()=>{
        await this.emitRaw({direction:"server_to_client",category:"notification",raw:JSON.stringify({method:"process/exited",params}),parsed:{method:"process/exited",params},method:"process/exited",requestId:null,timestamp:timestamp()});
        await this.dispatchNotification("process/exited",params);
      });
      if (!this.closed) this.rejectAll(new CodexIntegrationError("UNEXPECTED_PROCESS_EXIT", `Codex App Server exited unexpectedly (${code ?? signal ?? "unknown"}).`));
    });
  }

  async initialize(options: CodexInitializeOptions = {}): Promise<CodexServerInfo> {
    const result = await this.request("initialize", {
      clientInfo: { name: options.clientName ?? "continuum", title: "Continuum Shadow Flight Recorder", version: options.clientVersion ?? "0.1.0" },
      capabilities: options.experimentalApi ? { experimentalApi: true } : null,
    });
    if (!isRecord(result) || typeof result.userAgent !== "string" || typeof result.codexHome !== "string") {
      throw new CodexIntegrationError("INITIALIZATION_FAILURE", "Codex App Server returned an incompatible initialize response.");
    }
    await this.notify("initialized");
    return { userAgent: result.userAgent, codexHome: result.codexHome, platformFamily: String(result.platformFamily ?? "unknown"), platformOs: String(result.platformOs ?? "unknown") };
  }

  async readAccount(): Promise<CodexAccountState> {
    const result = await this.request("account/read", { refreshToken: false });
    if (!isRecord(result)) throw new CodexIntegrationError("PROTOCOL_INCOMPATIBILITY", "Codex account/read returned an incompatible response.");
    const account = isRecord(result.account) ? result.account : null;
    const mode = account && ["apiKey", "chatgpt", "amazonBedrock"].includes(String(account.type)) ? account.type as CodexAccountState["mode"] : "none";
    return { authenticated: account !== null || result.requiresOpenaiAuth === false, requiresOpenaiAuth: result.requiresOpenaiAuth === true, mode };
  }

  async startThread(options: CodexThreadOptions): Promise<CodexThread> {
    const result = await this.request("thread/start", {
      cwd: options.cwd,
      ...(options.model ? { model: options.model } : {}),
      approvalPolicy: options.approvalPolicy ?? "on-request",
      sandbox: options.sandbox ?? "workspace-write",
      ephemeral: false,
    });
    return this.threadFrom(result);
  }

  async resumeThread(threadId: string): Promise<CodexThread> {
    return this.threadFrom(await this.request("thread/resume", { threadId }));
  }

  async startTurn(options: CodexTurnOptions): Promise<CodexTurn> {
    const result = await this.request("turn/start", {
      threadId: options.threadId,
      input: [{ type: "text", text: options.task, text_elements: [] }],
      ...(options.model ? { model: options.model } : {}),
    });
    if (!isRecord(result) || !isRecord(result.turn) || typeof result.turn.id !== "string") {
      throw new CodexIntegrationError("PROTOCOL_INCOMPATIBILITY", "Codex turn/start returned an incompatible response.");
    }
    return { id: result.turn.id, threadId: options.threadId, status: String(result.turn.status ?? "inProgress") };
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.request("turn/interrupt", { threadId, turnId });
  }

  async respondToServerRequest(requestId: JsonRpcId, response: unknown): Promise<void> {
    await this.write({ id: requestId, result: response });
  }

  async close(): Promise<void> {
    if (!this.child) return;
    this.closed = true;
    const child = this.child;
    if (child.exitCode === null && !child.killed) {
      child.stdin.end();
      const timeout = this.options.shutdownTimeoutMs ?? 2_000;
      const exited = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), timeout);
        child.once("exit", () => { clearTimeout(timer); resolve(true); });
      });
      if (!exited && child.exitCode === null) child.kill();
    }
    this.rejectAll(new CodexIntegrationError("UNEXPECTED_PROCESS_EXIT", "Codex App Server client closed."));
    await this.inboundChain;
    await this.callbackChain;
    this.child = null;
  }

  private threadFrom(value: unknown): CodexThread {
    if (!isRecord(value) || !isRecord(value.thread) || typeof value.thread.id !== "string") {
      throw new CodexIntegrationError("PROTOCOL_INCOMPATIBILITY", "Codex thread response is incompatible.");
    }
    return { id: value.thread.id, model: typeof value.model === "string" ? value.model : null, modelProvider: typeof value.modelProvider === "string" ? value.modelProvider : null, cwd: String(value.cwd ?? value.thread.cwd ?? "") };
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (!this.child || this.child.exitCode !== null) throw new CodexIntegrationError("APP_SERVER_UNAVAILABLE", "Codex App Server is not running.");
    const id = this.nextId++;
    const timeoutMs = this.options.requestTimeoutMs ?? 30_000;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexIntegrationError("REQUEST_TIMEOUT", `Codex request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
    });
    try { await this.write({ id, method, params }); }
    catch (error) {
      const abandoned=this.pending.get(id);if(abandoned){clearTimeout(abandoned.timer);this.pending.delete(id);abandoned.resolve(undefined);}
      throw error;
    }
    return promise;
  }

  private async notify(method: string, params?: unknown): Promise<void> { await this.write(params === undefined ? { method } : { method, params }); }

  private async write(message: unknown): Promise<void> {
    if (!this.child || !this.child.stdin.writable) throw new CodexIntegrationError("APP_SERVER_UNAVAILABLE", "Codex App Server stdin is unavailable.");
    const raw = JSON.stringify(message);
    const record=isRecord(message)?message:{};const method=typeof record.method==="string"?record.method:null;const requestId=typeof record.id==="string"||typeof record.id==="number"?record.id:null;
    await this.emitRaw({ direction: "client_to_server", category: method&&requestId!==null?"request":requestId!==null?"response":"notification", raw, parsed: message, method, requestId, timestamp: timestamp() });
    await new Promise<void>((resolve, reject) => this.child!.stdin.write(raw + "\n", (error) => error ? reject(error) : resolve()));
  }

  private consumeStdout(text: string): void {
    this.stdoutBuffer += text;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.enqueueLine(line);
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private consumeStderr(text: string): void {
    this.stderrBuffer += text;
    let newline = this.stderrBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stderrBuffer.slice(0, newline).replace(/\r$/, "");
      this.stderrBuffer = this.stderrBuffer.slice(newline + 1);
      if (line) this.enqueueOperation(() => this.emitRaw({ direction: "server_stderr", category: "stderr", raw: line, parsed: null, method: null, requestId: null, timestamp: timestamp() }));
      newline = this.stderrBuffer.indexOf("\n");
    }
  }

  private async handleLine(raw: string): Promise<void> {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch {
      await this.emitRaw({ direction: "server_to_client", category: "malformed", raw, parsed: null, method: null, requestId: null, timestamp: timestamp() });
      await this.dispatchNotification("protocol/malformed", { raw });
      return;
    }
    if (!isRecord(parsed)) {
      await this.emitRaw({ direction: "server_to_client", category: "malformed", raw, parsed, method: null, requestId: null, timestamp: timestamp() });
      return;
    }
    const id = typeof parsed.id === "string" || typeof parsed.id === "number" ? parsed.id : null;
    const method = typeof parsed.method === "string" ? parsed.method : null;
    const category = method && id !== null ? "server_request" : method ? "notification" : id !== null ? "response" : "malformed";
    await this.emitRaw({ direction: "server_to_client", category, raw, parsed, method, requestId: id, timestamp: timestamp() });
    if (category === "response") this.handleResponse(parsed as unknown as JsonRpcResponse);
    else if (category === "server_request") await this.handleServerRequest({ id: id!, method: method!, params: parsed.params });
    else if (category === "notification") await this.dispatchNotification(method!, parsed.params);
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.error) pending.reject(new CodexIntegrationError("PROTOCOL_INCOMPATIBILITY", `${pending.method} failed: ${response.error.message}`, response.error));
    else pending.resolve(response.result);
  }

  private async handleServerRequest(request: CodexServerRequestContext): Promise<void> {
    try {
      let response: unknown;
      if (this.options.onServerRequest) response = await this.options.onServerRequest(request);
      else if (request.method === "item/commandExecution/requestApproval" || request.method === "item/fileChange/requestApproval") response = { decision: "decline" };
      else throw new CodexIntegrationError("UNSUPPORTED_SERVER_REQUEST", `Unsupported Codex server request: ${request.method}`);
      await this.respondToServerRequest(request.id, response);
    } catch (error) {
      await this.write({ id: request.id, error: { code: -32601, message: error instanceof Error ? error.message : String(error) } });
    }
  }

  private dispatchNotification(method: string, params: unknown): Promise<void> {
    const callback = this.options.onNotification;
    return callback ? this.queueCallback(() => callback(method, params)) : Promise.resolve();
  }

  private emitRaw(message: CodexRawMessage): Promise<void> {
    const callback = this.options.onRawMessage;
    return callback ? this.queueCallback(() => callback(message)) : Promise.resolve();
  }

  private queueCallback(callback: () => void | Promise<void>): Promise<void> {
    if (this.callbackFailure) return Promise.reject(this.callbackFailure);
    const current = this.callbackChain.then(callback);
    this.callbackChain = current.catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.callbackFailure = failure;
      void this.options.onFatalError?.(failure);
    });
    return current;
  }

  private enqueueLine(raw: string): void { this.enqueueOperation(() => this.handleLine(raw)); }

  private enqueueOperation(operation: () => Promise<void>): void {
    this.inboundChain = this.inboundChain.then(operation).catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.callbackFailure ??= failure;
      this.rejectAll(failure);
      void this.options.onFatalError?.(failure);
    });
  }

  private flushDecoders(): void {
    this.consumeStdout(this.stdoutDecoder.end());
    this.consumeStderr(this.stderrDecoder.end());
    if (this.stdoutBuffer) this.enqueueLine(this.stdoutBuffer);
    if (this.stderrBuffer) this.enqueueOperation(() => this.emitRaw({ direction: "server_stderr", category: "stderr", raw: this.stderrBuffer, parsed: null, method: null, requestId: null, timestamp: timestamp() }));
    this.stdoutBuffer = ""; this.stderrBuffer = "";
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }
}
