import type { Extractor, ExtractedSymbol } from "./types.js";

export class SqlExtractor implements Extractor {
  extract(absolutePath: string, content: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];
    const lines = content.split("\n");

    // A deterministic SQL statement parser
    // This looks for CREATE TABLE, CREATE INDEX, CREATE VIEW, etc.
    const createRegex = /CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|VIEW|VIRTUAL\s+TABLE)\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i;

    let currentStmt: string[] = [];
    let currentName: string | null = null;
    let currentKind: string | null = null;
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      if (currentStmt.length === 0) {
        const match = line.match(createRegex);
        if (match) {
          const [, type, name] = match;
          currentName = name ?? null;
          const typeStr = type ?? "";
          currentKind = typeStr.toUpperCase().includes("TABLE") ? "table" : 
                        typeStr.toUpperCase().includes("INDEX") ? "index" : "view";
          startLine = i + 1;
        }
      }
      
      if (currentName) {
        currentStmt.push(line);
        if (line.trim().endsWith(";")) {
          symbols.push({
            name: currentName,
            kind: currentKind!,
            content: currentStmt.join("\n"),
            startLine,
            endLine: i + 1,
          });
          currentStmt = [];
          currentName = null;
          currentKind = null;
        }
      }
    }

    return symbols;
  }
}
