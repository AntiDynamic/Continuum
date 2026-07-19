/**
 * Version-matched protocol adapter for Codex 0.133.0 dynamic tools.
 * Sourced from the generated Codex 0.133.0 experimental schema.
 */

/**
 * Specification for a dynamic tool registered at thread start.
 */
export interface CodexDynamicToolSpec {
  name: string;
  description: string;
  inputSchema: any;
  deferLoading?: boolean;
  namespace?: string | null;
}

/**
 * Parameters received from Codex when it calls a dynamic tool.
 */
export interface DynamicToolCallParams {
  threadId: string;
  turnId: string;
  callId: string;
  namespace: string | null;
  tool: string;
  arguments: any;
}

/**
 * A content item in a dynamic tool call response.
 */
export interface DynamicToolCallOutputContentItem {
  type: "inputText";
  text: string;
}

/**
 * Response sent back to Codex after a dynamic tool call.
 */
export interface DynamicToolCallResponse {
  success: boolean;
  contentItems: DynamicToolCallOutputContentItem[];
}
