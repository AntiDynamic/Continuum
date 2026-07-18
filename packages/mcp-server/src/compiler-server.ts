import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ContextEngine } from "@continuum/context-engine";
import { RepositoryRepository, migrate, openDatabase } from "@continuum/database";
import { getCurrentCommit, getPorcelainStatus, getRepositoryRoot } from "@continuum/git-analyzer";
import type { IndexSnapshotIdentity } from "@continuum/shared";

interface EngineScope {
  engine: ContextEngine;
  close(): void;
}

function protocolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export class ContinuumMcpServer {
  private readonly server = new McpServer({ name: "Continuum", version: "0.2.0" });

  constructor(private readonly cwd: string) {
    this.setupTools();
  }

  private async scopedEngine(requestedPath?: string): Promise<EngineScope> {
    const repositoryRoot = await getRepositoryRoot(this.cwd);
    const target = resolve(this.cwd, requestedPath ?? ".");
    const fromRoot = relative(repositoryRoot, target);
    if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new Error("Requested path is outside the configured repository root.");
    }
    const dbPath = join(repositoryRoot, ".continuum", "continuum.db");
    if (!existsSync(dbPath)) throw new Error(`Continuum is not initialised at ${repositoryRoot}.`);
    const db = openDatabase(dbPath);
    migrate(db);
    const repository = new RepositoryRepository(db).findByPath(repositoryRoot);
    if (!repository) {
      db.close();
      throw new Error("Repository is not registered in the Continuum database.");
    }
    const status = await getPorcelainStatus(repositoryRoot);
    const snapshot: IndexSnapshotIdentity = {
      snapshot_kind: status.length ? "worktree" : "commit",
      base_commit_hash: (await getCurrentCommit(repositoryRoot)) ?? "unborn",
      worktree_hash: null,
      dirty: status.length > 0,
    };
    return { engine: new ContextEngine(db, repository.id, snapshot), close: () => db.close() };
  }

  private setupTools(): void {
    const searchSchema = {
      query: z.string().min(1),
      path: z.string().optional().describe("Repository-contained path only."),
    };
    this.server.tool("continuum_search_context", "Search current repository context with evidence.", searchSchema, async (args) => {
      try {
        const scope = await this.scopedEngine(args.path);
        try { return protocolResult({ items: await scope.engine.search(args.query) }); }
        finally { scope.close(); }
      } catch (error: unknown) { return protocolResult({ error: error instanceof Error ? error.message : String(error) }); }
    });
    this.server.tool("continuum_get_context_packet", "Build a budget-constrained context packet.", searchSchema, async (args) => {
      try {
        const scope = await this.scopedEngine(args.path);
        try { return protocolResult(await scope.engine.packet(args.query)); }
        finally { scope.close(); }
      } catch (error: unknown) { return protocolResult({ error: error instanceof Error ? error.message : String(error) }); }
    });
    this.server.tool("continuum_get_context_coverage", "Analyze required and missing context coverage.", searchSchema, async (args) => {
      try {
        const scope = await this.scopedEngine(args.path);
        try {
          const task = scope.engine.analyze(args.query);
          const items = await scope.engine.search(args.query);
          return protocolResult({ task, coverage: scope.engine.coverageFor(task, items) });
        } finally { scope.close(); }
      } catch (error: unknown) { return protocolResult({ error: error instanceof Error ? error.message : String(error) }); }
    });
    this.server.tool("continuum_explain_context_item", "Explain a repository-scoped context item.", {
      item_id: z.string().uuid(),
      path: z.string().optional().describe("Repository-contained path only."),
    }, async (args) => {
      try {
        const scope = await this.scopedEngine(args.path);
        try { return protocolResult({ item: scope.engine.explain(args.item_id) ?? null }); }
        finally { scope.close(); }
      } catch (error: unknown) { return protocolResult({ error: error instanceof Error ? error.message : String(error) }); }
    });
    this.server.tool("retrieve_context", "Compatibility alias for continuum_get_context_packet.", searchSchema, async (args) => {
      try {
        const scope = await this.scopedEngine(args.path);
        try { return protocolResult(await scope.engine.packet(args.query)); }
        finally { scope.close(); }
      } catch (error: unknown) { return protocolResult({ error: error instanceof Error ? error.message : String(error) }); }
    });
  }

  async connect(transport: Parameters<McpServer["connect"]>[0]): Promise<void> {
    await this.server.connect(transport);
  }

  async start(): Promise<void> {
    await this.server.connect(new StdioServerTransport());
  }
}
