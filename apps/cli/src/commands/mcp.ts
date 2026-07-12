import { ContinuumMcpServer } from "@continuum/mcp-server";

export async function runMcpCommand(options: { cwd: string }) {
  const server = new ContinuumMcpServer(options.cwd);
  await server.start();
}
