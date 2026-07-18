import yaml from "yaml";
import type { ExtractedSymbol, Extractor } from "./types.js";

function lineFor(lines: string[], key: string, format: "json" | "yaml"): number {
  const pattern = format === "json" ? `"${key}"` : `${key}:`;
  const index = lines.findIndex((line) => line.includes(pattern));
  return index < 0 ? 1 : index + 1;
}

function sections(value: unknown, lines: string[], format: "json" | "yaml", prefix = "", depth = 0): ExtractedSymbol[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return [];
  const result: ExtractedSymbol[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const name = prefix ? `${prefix}.${key}` : key;
    const structured = child && typeof child === "object";
    if (!structured && depth > 0) continue;
    const startLine = lineFor(lines, key, format);
    const rendered = format === "json" ? JSON.stringify({ [key]: child }, null, 2) : yaml.stringify({ [key]: child }).trimEnd();
    result.push({ name, kind: format === "json" ? "json_key" : "yaml_key", content: rendered, startLine, endLine: startLine + rendered.split(/\r?\n/).length - 1, metadata: { configurationPath: name.split("."), sectionKind: ["scripts", "dependencies", "devDependencies", "workspaces"].includes(key) ? key : "configuration" } });
    if (structured && !Array.isArray(child)) result.push(...sections(child, lines, format, name, depth + 1));
  }
  return result;
}

export class JsonConfigurationExtractor implements Extractor {
  extract(_absolutePath: string, content: string): ExtractedSymbol[] {
    try { return sections(JSON.parse(content), content.split(/\r?\n/), "json"); } catch { return []; }
  }
}

export class YamlConfigurationExtractor implements Extractor {
  extract(_absolutePath: string, content: string): ExtractedSymbol[] {
    try { return sections(yaml.parse(content), content.split(/\r?\n/), "yaml"); } catch { return []; }
  }
}
