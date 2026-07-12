import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDatabase, ContextRepository, RepositoryRepository, RepositoryRow } from "@continuum/database";
import { rankResults, packContext } from "@continuum/shared";
import { getRepositoryRoot } from "@continuum/git-analyzer";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";

export class ContinuumMcpServer {
  private server: McpServer;
  private dbPath: string | null = null;
  private repoId: number | null = null;
  
  constructor(private readonly cwd: string) {
    this.server = new McpServer({
      name: "Continuum",
      version: "0.1.0"
    });
    
    this.setupTools();
  }
  
  private async initDatabase(targetPath: string) {
    if (this.dbPath) return; // Already initialised
    
    try {
      const repoRoot = await getRepositoryRoot(targetPath);
      const dbFile = join(repoRoot, ".continuum", "continuum.db");
      
      if (!existsSync(dbFile)) {
        throw new Error(`Continuum not initialised at ${repoRoot}`);
      }
      
      this.dbPath = dbFile;
      const db = openDatabase(dbFile);
      const repoRepo = new RepositoryRepository(db);
      
      // Get the repository ID
      const repoRow = repoRepo.findByPath(repoRoot);
      if (!repoRow) {
        throw new Error("Repository not found in Continuum database.");
      }
      
      this.repoId = repoRow.id;
      db.close();
    } catch (err: any) {
      throw new Error(`Failed to initialise database: ${err.message}`);
    }
  }

  private setupTools() {
      this.server.tool(
      "retrieve_context",
      "Retrieve packed codebase context for a query using Continuum.",
      {
        query: z.string().describe("The search query (keywords, symbol names, or intent)."),
        path: z.string().optional().describe("Path to search within (defaults to current directory)."),
        run_id: z.string().optional().describe("Continuum run ID making this request (optional).")
      },
      async (args) => {
        const targetPath = resolve(this.cwd, args.path || ".");
        
        try {
          await this.initDatabase(targetPath);
          
          if (!this.dbPath || this.repoId === null) {
            return {
              content: [{ type: "text", text: "Error: Database not initialised." }]
            };
          }
          
          const db = openDatabase(this.dbPath);
          const contextRepo = new ContextRepository(db);
          
          const rawResults = contextRepo.searchContextItems(args.query, 50, this.repoId);
          const ranked = rankResults(args.query, rawResults);
          const packet = packContext(ranked);
          
          let responseText = `Context for "${args.query}" (Packed ${packet.totalItems} items, ${packet.totalCharacters} chars):\n\n`;
          
          for (const item of packet.items) {
            responseText += `--- [${item.version.source_path}:${item.version.symbol_name}] ---\n`;
            responseText += item.version.content;
            responseText += `\n\n`;
          }
          
          // Record the retrieval
          contextRepo.recordRetrieval({
            id: crypto.randomUUID(),
            runId: args.run_id,
            query: args.query,
            strategy: "mcp",
            packetJson: JSON.stringify(packet),
            items: packet.items.map((item, idx) => ({
              versionId: item.version.id,
              score: item.finalScore,
              scoreComponentsJson: JSON.stringify(item.components),
              rank: idx + 1
            }))
          });
          
          db.close();
          
          return {
            content: [{ type: "text", text: responseText }]
          };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: `Error: ${err.message}` }]
          };
        }
      }
    );
  }
  
  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Continuum MCP server started on stdio.");
  }
}
