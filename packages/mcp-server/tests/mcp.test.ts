import { describe, it, expect } from "vitest";
import { ContinuumMcpServer } from "../src/compiler-server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resolve } from "node:path";

describe("ContinuumMcpServer", () => {
  it("initialises without crashing", () => {
    const server = new ContinuumMcpServer(resolve(__dirname, "../../.."));
    expect(server).toBeDefined();
  });
  
  it("supports client tool listing", async () => {
    const srv = new ContinuumMcpServer(resolve(__dirname, "../../.."));
    
    // Set up in-memory transport
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    
    // Connect server
    await srv.connect(serverTransport);
    
    // Connect client
    const client = new Client(
      { name: "TestClient", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(clientTransport);
    
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "continuum_search_context",
      "continuum_get_context_packet",
      "continuum_explain_context_item",
      "continuum_get_context_coverage",
      "retrieve_context",
    ]));
    const escaped = await client.callTool({
      name: "continuum_search_context",
      arguments: { query: "context", path: "../../" },
    });
    expect(escaped.structuredContent).toMatchObject({
      error: expect.stringContaining("outside the configured repository root"),
    });
    
    await client.close();
  });
});
