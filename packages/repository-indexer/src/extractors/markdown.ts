import type { Extractor, ExtractedSymbol } from "./types.js";

export class MarkdownExtractor implements Extractor {
  extract(absolutePath: string, content: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];
    const lines = content.split("\n");

    let currentSection: { title: string, startLine: number, content: string[] } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      
      if (match) {
        if (currentSection) {
          symbols.push({
            name: currentSection.title,
            kind: "heading",
            content: currentSection.content.join("\n"),
            startLine: currentSection.startLine,
            endLine: i,
          });
        }
        
        currentSection = {
          title: match[2] ?? "",
          startLine: i + 1,
          content: [line]
        };
      } else if (currentSection) {
        currentSection.content.push(line);
      }
    }

    if (currentSection) {
      symbols.push({
        name: currentSection.title,
        kind: "heading",
        content: currentSection.content.join("\n"),
        startLine: currentSection.startLine,
        endLine: lines.length,
      });
    }

    return symbols;
  }
}
