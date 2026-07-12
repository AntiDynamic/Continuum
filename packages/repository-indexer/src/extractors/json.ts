import type { Extractor, ExtractedSymbol } from "./types.js";

export class JsonExtractor implements Extractor {
  extract(absolutePath: string, content: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];
    try {
      const parsed = JSON.parse(content);
      const lines = content.split("\n");
      
      // We'll extract top-level keys if it's an object
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const key of Object.keys(parsed)) {
          // Find the approximate line where the key is defined
          // This is a naive heuristic without a full JSON AST parser
          const keyString = `"${key}"`;
          const lineIndex = lines.findIndex(l => l.includes(keyString));
          const startLine = lineIndex >= 0 ? lineIndex + 1 : 1;
          
          symbols.push({
            name: key,
            kind: "json_key",
            content: JSON.stringify(parsed[key], null, 2),
            startLine,
            endLine: startLine, // Approximated
          });
        }
      }
    } catch {
      // Ignore invalid JSON
    }
    return symbols;
  }
}
