import { posix } from "node:path";
import type { CompiledContextItem, PersistedContextRelationship } from "@continuum/shared";

export interface IndexedCompiledItem { compiled: CompiledContextItem; contextItemId: string }

function stem(path: string): string {
  return path.replaceAll("\\", "/").replace(/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/i, "").replace(/\/index$/i, "");
}

export function inferContextRelationships(entries: IndexedCompiledItem[]): PersistedContextRelationship[] {
  const relationships: PersistedContextRelationship[] = [];
  const add = (source: IndexedCompiledItem, target: IndexedCompiledItem, kind: PersistedContextRelationship["kind"], confidence: PersistedContextRelationship["confidence"], description: string): void => {
    if (source.contextItemId === target.contextItemId) return;
    relationships.push({ id: crypto.randomUUID(), sourceContextItemId: source.contextItemId, targetContextItemId: target.contextItemId, kind, confidence, evidence: { sourcePath: source.compiled.sourcePath, sourceStartLine: source.compiled.sourceStartLine, sourceEndLine: source.compiled.sourceEndLine, description } });
  };
  const byLogicalKey = new Map(entries.map((entry) => [entry.compiled.logicalKey, entry]));
  for (const entry of entries) {
    if (entry.compiled.parentSymbol) {
      const parent = byLogicalKey.get(`${entry.compiled.sourcePath}:${entry.compiled.parentSymbol}`);
      if (parent) add(parent, entry, "contains", "high", `${entry.compiled.parentSymbol} syntactically contains ${entry.compiled.symbolName}.`);
    }
    if (entry.compiled.kind === "import") {
      const moduleName = entry.compiled.content.match(/(?:from\s+|import\s*)["']([^"']+)["']/)?.[1];
      if (moduleName?.startsWith(".")) {
        const expected = stem(posix.normalize(posix.join(posix.dirname(entry.compiled.sourcePath.replaceAll("\\", "/")), moduleName)));
        const target = entries.find((candidate) => stem(candidate.compiled.sourcePath) === expected && candidate.compiled.kind !== "import");
        if (target) add(entry, target, "imports", "high", `Static import resolves ${moduleName} to ${target.compiled.sourcePath}.`);
      }
    }
    if (entry.compiled.kind === "export") {
      const target = entries.find((candidate) => candidate.compiled.sourcePath === entry.compiled.sourcePath && candidate.compiled.symbolName && entry.compiled.content.includes(candidate.compiled.symbolName) && candidate.compiled.kind !== "export");
      if (target) add(entry, target, "exports", "high", `Export declaration explicitly names ${target.compiled.symbolName}.`);
    }
    if (entry.compiled.kind === "test") {
      for (const target of entries) {
        if (target.compiled.kind === "test" || target.compiled.sourcePath === entry.compiled.sourcePath || !target.compiled.symbolName) continue;
        if (entry.compiled.content.includes(target.compiled.symbolName)) add(entry, target, "tests", "high", `Test content directly references ${target.compiled.symbolName}.`);
      }
    }
    if (entry.compiled.kind === "configuration" && /(^|\/)(package\.json|tsconfig[^/]*\.json|[^/]+\.ya?ml)$/i.test(entry.compiled.sourcePath)) {
      const directory = posix.dirname(entry.compiled.sourcePath.replaceAll("\\", "/"));
      const prefix = directory === "." ? "" : `${directory}/`;
      for (const target of entries.filter((candidate) => candidate.compiled.sourcePath.startsWith(prefix) && ["class", "function", "interface"].includes(candidate.compiled.kind)).slice(0, 10)) {
        add(entry, target, "configures", "medium", `${entry.compiled.sourcePath} is verified package or build configuration for ${target.compiled.sourcePath}.`);
      }
    }
  }
  return relationships;
}
