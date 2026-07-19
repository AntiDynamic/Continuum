import type { CodexServerRequestContext } from "./protocol.js";
import type { DynamicToolCallResponse, DynamicToolCallParams } from "./protocol-adapters/0.133.0/dynamic-tools.js";

export interface CodexRequestHandler {
  handleRequest(request: CodexServerRequestContext): Promise<unknown | null>;
}

export class AssistToolRouter implements CodexRequestHandler {
  constructor(private readonly onContextRequest: (query: string) => Promise<string>) {}

  async handleRequest(request: CodexServerRequestContext): Promise<DynamicToolCallResponse | null> {
    if (request.method !== "item/tool/call") return null;
    
    const params = request.params as DynamicToolCallParams;
    if (!params || params.tool !== "continuum_request_context") return null;

    const args = params.arguments as { query?: string };
    const query = args?.query?.trim();
    
    if (!query) {
      return {
        success: false,
        contentItems: [{ type: "inputText", text: "Error: Missing query argument." }]
      };
    }

    try {
      const result = await this.onContextRequest(query);
      return {
        success: true,
        contentItems: [{ type: "inputText", text: result }]
      };
    } catch (error) {
      return {
        success: false,
        contentItems: [{ type: "inputText", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
}
