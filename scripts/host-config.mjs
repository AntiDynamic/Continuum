/** Current OpenCode schema: server names are direct keys under mcp. */
export function openCodeMcpConfiguration(original, { enabled, command, targeted = false }) {
  const next = original ? JSON.parse(original) : {};
  const mcp = { ...(next.mcp ?? {}) };
  delete mcp.continuum;
  if (enabled) mcp.continuum = { type:"local",command,enabled:true,environment:{CONTINUUM_MCP_COMPACT:"1",...(targeted?{CONTINUUM_MCP_TARGETED:"1"}:{})} };
  return { ...next, $schema:next.$schema??"https://opencode.ai/config.json", mcp };
}
