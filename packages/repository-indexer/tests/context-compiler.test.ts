import { describe, expect, it } from "vitest";
import { CoherentMarkdownExtractor, DeterministicContextCompiler, JsonConfigurationExtractor, StatementSqlExtractor, TypeScriptCompilerApiExtractor, YamlConfigurationExtractor } from "../src/index.js";

describe("Context Compiler extractors", () => {
  it("extracts TypeScript declarations and traceable metadata", () => {
    const source = `import { z } from "zod";
/** Parse a line. */
export function parseLine(value: string): boolean { return Boolean(value); }
export const arrow = async (value: number) => value + 1;
export const Schema = z.object({ id: z.string() });
export interface Result { ok: boolean }
export type Id = string;
export enum State { Ready }
export class Parser { constructor(readonly id: Id) {} run(): Result { return { ok: true }; } }
describe("parser", () => { test("parseLine", () => parseLine("x")); });
program.command("index");`;
    const items = new TypeScriptCompilerApiExtractor().extract("fixture.ts", source);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "parseLine", kind: "function", purpose: expect.objectContaining({ source: "jsdoc" }) }),
      expect.objectContaining({ name: "arrow", kind: "function", metadata: expect.objectContaining({ declarationKind: "arrow_function" }) }),
      expect.objectContaining({ name: "Schema", kind: "configuration" }),
      expect.objectContaining({ name: "Result", kind: "interface" }),
      expect.objectContaining({ name: "Id", kind: "type" }),
      expect.objectContaining({ name: "State", kind: "enum" }),
      expect.objectContaining({ name: "Parser.constructor", kind: "constructor", parentSymbol: "Parser" }),
      expect.objectContaining({ name: "Parser.run", kind: "method", parentSymbol: "Parser" }),
      expect.objectContaining({ name: "parseLine", kind: "test" }),
      expect.objectContaining({ name: "index", metadata: expect.objectContaining({ declarationKind: "cli_command" }) }),
    ]));
  });

  it("extracts coherent Markdown paths, nested configuration, and SQL statements", () => {
    const markdown = new CoherentMarkdownExtractor().extract("README.md", "# Project\nIntro\n## Security\nMust authenticate.\n```sh\npnpm test\n```");
    expect(markdown[1]).toMatchObject({ name: "Project > Security", metadata: expect.objectContaining({ headingPath: ["Project", "Security"], codeBlockCount: 1 }) });
    expect(new JsonConfigurationExtractor().extract("package.json", '{"scripts":{"test":"vitest"},"dependencies":{"zod":"1"}}').map((item) => item.name)).toEqual(expect.arrayContaining(["scripts", "dependencies"]));
    expect(new YamlConfigurationExtractor().extract("config.yml", "service:\n  auth:\n    required: true\n").map((item) => item.name)).toContain("service.auth");
    const sql = new StatementSqlExtractor().extract("migration.sql", "CREATE TABLE users (\n id TEXT PRIMARY KEY\n);\nDROP TABLE users;");
    expect(sql).toEqual(expect.arrayContaining([expect.objectContaining({ name: "users", kind: "table" }), expect.objectContaining({ kind: "rollback" })]));
  });

  it("builds stable contextual headers, provenance, purpose, and hashes", async () => {
    const compiler = new DeterministicContextCompiler();
    const input = { repositoryId: 1, repositoryRoot: "/repo", sourcePath: "src/a.ts", language: "typescript", sourceContent: "/** Verify input. */\nexport function verify() {}", snapshot: { snapshot_kind: "commit" as const, base_commit_hash: "abc", worktree_hash: null, dirty: false }, extractedCandidates: new TypeScriptCompilerApiExtractor().extract("src/a.ts", "/** Verify input. */\nexport function verify() {}"), repositoryMetadata: { name: "fixture", packageName: "@fixture/core" } };
    const first = await compiler.compile(input);
    const second = await compiler.compile(input);
    expect(first[0]?.contextualHeader).toBe(second[0]?.contextualHeader);
    expect(first[0]?.contentHash).toBe(second[0]?.contentHash);
    expect(first[0]?.compiledContent).toContain(first[0]?.content);
    expect(first[0]?.provenance.extractor).toBe("typescript-compiler-api-v2");
    expect(first[0]?.metadata.purpose.source).toBe("jsdoc");
  });
});
