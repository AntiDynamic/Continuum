export type CodexErrorCode =
  | "CODEX_EXECUTABLE_UNAVAILABLE" | "APP_SERVER_UNAVAILABLE" | "INITIALIZATION_FAILURE"
  | "AUTHENTICATION_REQUIRED" | "PROTOCOL_INCOMPATIBILITY" | "MALFORMED_SERVER_MESSAGE"
  | "REQUEST_TIMEOUT" | "UNEXPECTED_PROCESS_EXIT" | "TURN_FAILURE" | "TURN_INTERRUPTED"
  | "APPROVAL_DECLINED" | "UNSUPPORTED_SERVER_REQUEST";

export class CodexIntegrationError extends Error {
  constructor(public readonly code: CodexErrorCode, message: string, public readonly details?: unknown) {
    super(message);
    this.name = "CodexIntegrationError";
  }
}
