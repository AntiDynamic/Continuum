import { basename } from "node:path";
import { hashString } from "./hashing.js";
import type { CompiledContextItem, ConstraintKind, ContextCompilationInput, ContextCompiler, ContextItemKind, PurposeEvidence } from "@continuum/shared";

const AUTHORITATIVE_DOCS = /^(AGENTS|README|SECURITY|CONTRIBUTING)\.md$|^docs\/(architecture|privacy|limitations)\.md$/i;
const CONSTRAINT_WORDS = /\b(must|must not|never|required|unsupported|security|privacy|trust|approval|authentication|backward compatibility)\b/i;

function asKind(kind: string): ContextItemKind {
  const supported = new Set<ContextItemKind>(["file", "function", "method", "class", "constructor", "interface", "type", "enum", "constant", "import", "export", "test", "heading", "configuration", "table", "index", "view", "trigger", "migration", "constraint"]);
  if (kind === "json_key" || kind === "yaml_key") return "configuration";
  return supported.has(kind as ContextItemKind) ? kind as ContextItemKind : "unknown";
}

function commentPurpose(content: string): PurposeEvidence | undefined {
  const jsdoc = content.match(/^\s*\/\*\*([\s\S]*?)\*\//)?.[1]?.split("\n").map((line) => line.replace(/^\s*\*\s?/, "").trim()).filter(Boolean).join(" ");
  if (jsdoc) return { text: jsdoc, source: "jsdoc" };
  const comment = content.match(/^\s*\/\/\s*(.+)$/m)?.[1]?.trim();
  return comment ? { text: comment, source: "leading_comment" } : undefined;
}

function purposeFor(name: string, kind: ContextItemKind, content: string): PurposeEvidence {
  const documented = commentPurpose(content);
  if (documented) return documented;
  if (name && name !== "import" && name !== "export") return { text: `Declares ${kind} ${name}.`, source: "symbol_name" };
  return { text: "No verified purpose description available.", source: "unknown" };
}

function constraintKind(content: string): ConstraintKind {
  if (/privacy/i.test(content)) return "privacy";
  if (/security|auth|secret|trust|permission/i.test(content)) return "security";
  if (/backward compatibility|unsupported/i.test(content)) return "compatibility";
  if (/test|required check/i.test(content)) return "testing";
  if (/deploy|runtime|operational/i.test(content)) return "operational";
  return "architecture";
}

export class DeterministicContextCompiler implements ContextCompiler {
  async compile(input: ContextCompilationInput): Promise<CompiledContextItem[]> {
    const sourceFileHash = hashString(input.sourceContent);
    const packageName = input.repositoryMetadata.packageName ?? "unknown";
    const importantImports = input.extractedCandidates.filter((candidate) => candidate.kind === "import").map((candidate) => candidate.content.match(/from\s+["']([^"']+)["']/)?.[1]).filter((value): value is string => Boolean(value)).sort();
    return input.extractedCandidates.map((candidate) => {
      const authoritativeConstraint = AUTHORITATIVE_DOCS.test(input.sourcePath) && CONSTRAINT_WORDS.test(candidate.content);
      const kind = authoritativeConstraint ? "constraint" : asKind(candidate.kind);
      const purpose = candidate.purpose ?? purposeFor(candidate.name, kind, candidate.content);
      const relatedTests = candidate.metadata?.["relatedTests"] as string[] | undefined;
      const provenance = { repositoryId: input.repositoryId, sourcePath: input.sourcePath, sourceStartLine: candidate.startLine, sourceEndLine: candidate.endLine, extractor: `${input.language}-compiler-api-v2`, snapshot: input.snapshot, confidence: "high" as const };
      const snapshot = input.snapshot.snapshot_kind === "commit" ? `commit ${input.snapshot.base_commit_hash}` : `worktree ${input.snapshot.worktree_hash ?? "unknown"} on ${input.snapshot.base_commit_hash}`;
      const contextualHeader = [
        `Repository: ${input.repositoryMetadata.name}`, `Package: ${packageName}`, `File: ${input.sourcePath}`,
        `Symbol: ${candidate.name || "none"}`, `Kind: ${kind}`, `Parent: ${candidate.parentSymbol ?? "none"}`,
        `Purpose: ${purpose.text}`, `Related tests: ${relatedTests?.sort().join(", ") || "none verified"}`,
        `Important imports: ${importantImports.join(", ") || "none"}`, `Snapshot: ${snapshot}`,
        `Staleness: ${input.snapshot.dirty ? "uncommitted" : "current"}`, `Provenance: ${provenance.extractor}`,
      ].join("\n");
      const compiledContent = `${contextualHeader}\n\n${candidate.content}`;
      return {
        logicalKey: `${input.sourcePath}:${candidate.name}`, kind, title: candidate.name || basename(input.sourcePath),
        content: candidate.content, contextualHeader, compiledContent, sourcePath: input.sourcePath,
        sourceStartLine: candidate.startLine, sourceEndLine: candidate.endLine, symbolName: candidate.name || undefined,
        parentSymbol: candidate.parentSymbol, language: input.language, contentHash: hashString(compiledContent),
        sourceFileHash, sourceBlobHash: sourceFileHash, provenance,
        metadata: { packageName, purpose, relatedTests, importantImports, constraintKind: authoritativeConstraint ? constraintKind(candidate.content) : undefined, authoritySource: authoritativeConstraint ? input.sourcePath : undefined, parseConfidence: "high", ...(candidate.metadata ?? {}) },
        relationships: candidate.relationships ?? [],
      };
    });
  }
}
