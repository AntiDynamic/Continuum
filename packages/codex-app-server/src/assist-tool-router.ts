import {isRecord} from "./json.js";
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

    const args = isRecord(params.arguments) ? params.arguments : {};
    const wrapped=isRecord(args["args"])?args["args"]:{};
    const direct=args["query"],nested=wrapped["query"];
    // Real pilot C supplied one extra args wrapper. Normalize that exact shape;
    // never coerce types or silently choose between conflicting queries.
    const invalid=direct!==undefined&&typeof direct!=="string"||nested!==undefined&&typeof nested!=="string"||typeof direct==="string"&&typeof nested==="string"&&direct.trim()!==nested.trim();
    const query=invalid?"":typeof direct==="string"?direct.trim():typeof nested==="string"?nested.trim():"";
    
    if (!query) {
      return {
        success: false,
        contentItems: [{ type: "inputText", text: 'Error: Expected a nonempty string query: {query: "path or symbol"}. A single args wrapper is accepted; conflicting queries are rejected.' }]
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
