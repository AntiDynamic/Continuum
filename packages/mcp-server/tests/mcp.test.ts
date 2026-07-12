import { describe, it, expect } from "vitest";
import { ContinuumMcpServer } from "../src/server.js";
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
    await (srv as any).server.connect(serverTransport);
    
    // Connect client
    const client = new Client(
      { name: "TestClient", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(clientTransport);
    
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);
    expect(tools.tools.find(t => t.name === "retrieve_context")).toBeDefined();
    
    await client.close();
  });
});
