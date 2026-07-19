import type { CodexDynamicToolSpec } from "./protocol-adapters/0.133.0/dynamic-tools.js";

export type JsonRpcId = string | number;
export interface JsonRpcRequest { id: JsonRpcId; method: string; params?: unknown }
export interface JsonRpcNotification { method: string; params?: unknown }
export interface JsonRpcResponse { id: JsonRpcId; result?: unknown; error?: { code: number; message: string; data?: unknown } }
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export type CodexApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type CodexApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface CodexInitializeOptions {
  clientName?: string;
  clientVersion?: string;
  experimentalApi?: boolean;
}
export interface CodexServerInfo { userAgent: string; codexHome: string; platformFamily: string; platformOs: string }
export interface CodexAccountState { authenticated: boolean; requiresOpenaiAuth: boolean; mode: "apiKey" | "chatgpt" | "amazonBedrock" | "none" }
export interface CodexThreadOptions { cwd: string; model?: string; approvalPolicy?: CodexApprovalPolicy; sandbox?: CodexSandboxMode; dynamicTools?: CodexDynamicToolSpec[] }
export interface CodexThread { id: string; model: string | null; modelProvider: string | null; cwd: string }
export interface CodexTextInput { type: "text"; text: string; text_elements: [] }
export interface CodexTurnOptions { threadId: string; task?: string; inputs?: CodexTextInput[]; model?: string }
export interface CodexTurn { id: string; threadId: string; status: string }

export interface CodexRawMessage {
  direction: "client_to_server" | "server_to_client" | "server_stderr";
  category: "request" | "response" | "notification" | "server_request" | "malformed" | "stderr";
  raw: string;
  parsed: unknown | null;
  method: string | null;
  requestId: JsonRpcId | null;
  timestamp: string;
}

export interface CodexServerRequestContext {
  id: JsonRpcId;
  method: string;
  params: unknown;
}

export interface CodexProcessOptions {
  executable?: string;
  executableArgs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  onRawMessage?: (message: CodexRawMessage) => void | Promise<void>;
  onNotification?: (method: string, params: unknown) => void | Promise<void>;
  onServerRequest?: (request: CodexServerRequestContext) => Promise<unknown>;
  onFatalError?: (error: Error) => void | Promise<void>;
}

export interface CodexAppServerClient {
  start(options?: CodexProcessOptions): Promise<void>;
  initialize(options?: CodexInitializeOptions): Promise<CodexServerInfo>;
  readAccount(): Promise<CodexAccountState>;
  startThread(options: CodexThreadOptions): Promise<CodexThread>;
  resumeThread(threadId: string): Promise<CodexThread>;
  startTurn(options: CodexTurnOptions): Promise<CodexTurn>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  respondToServerRequest(requestId: JsonRpcId, response: unknown): Promise<void>;
  close(): Promise<void>;
}
