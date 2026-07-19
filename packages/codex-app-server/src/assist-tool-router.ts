import type { CodexServerRequestContext, CodexApprovalDecision } from "./protocol.js";

export interface CodexRequestHandler {
  handleRequest(request: CodexServerRequestContext): Promise<{ decision: CodexApprovalDecision; stdout?: string } | null>;
}

export class AssistToolRouter implements CodexRequestHandler {
  constructor(private readonly onContextRequest: (query: string) => Promise<string>) {}

  async handleRequest(request: CodexServerRequestContext): Promise<{ decision: CodexApprovalDecision; stdout?: string } | null> {
    if (request.method !== "item/commandExecution/requestApproval") return null;
    const params = request.params as { command?: string };
    if (!params || typeof params.command !== "string") return null;

    const command = params.command.trim();
    if (command.startsWith("continuum_context ")) {
      const query = command.slice("continuum_context ".length).trim();
      try {
        const result = await this.onContextRequest(query);
        // By returning decision: "simulate", we instruct the modified client.ts to bypass execution
        // and instantly resolve the command with the simulated stdout.
        return { decision: "simulate" as any, stdout: result };
      } catch (error) {
        return { decision: "simulate" as any, stdout: `Error: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    
    return null;
  }
}
