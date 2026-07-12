import type { Extractor, ExtractedSymbol } from "./types.js";
import yaml from "yaml";

export class YamlExtractor implements Extractor {
  extract(absolutePath: string, content: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];
    try {
      const parsed = yaml.parse(content);
      const lines = content.split("\n");
      
      // We'll extract top-level keys if it's an object
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const key of Object.keys(parsed)) {
          // Find the approximate line where the key is defined
          const keyString = `${key}:`;
          const lineIndex = lines.findIndex(l => l.trim().startsWith(keyString));
          const startLine = lineIndex >= 0 ? lineIndex + 1 : 1;
          
          symbols.push({
            name: key,
            kind: "yaml_key",
            content: yaml.stringify({ [key]: parsed[key] }),
            startLine,
            endLine: startLine, // Approximated
          });
        }
      }
    } catch {
      // Ignore invalid YAML
    }
    return symbols;
  }
}
