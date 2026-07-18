import type { ExtractedSymbol, Extractor } from "./types.js";

interface Heading { level: number; title: string; line: number }

export class CoherentMarkdownExtractor implements Extractor {
  extract(_absolutePath: string, content: string): ExtractedSymbol[] {
    const lines = content.split(/\r?\n/);
    const headings: Heading[] = [];
    lines.forEach((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (match?.[1] && match[2]) headings.push({ level: match[1].length, title: match[2], line: index });
    });
    return headings.map((heading, index) => {
      const end = headings[index + 1]?.line ?? lines.length;
      const stack = headings.slice(0, index + 1).filter((candidate, candidateIndex, all) => candidate.level <= heading.level && !all.slice(candidateIndex + 1).some((later) => later.level <= candidate.level && later.line < heading.line));
      const headingPath: string[] = [];
      for (const candidate of stack) {
        while (headingPath.length >= candidate.level) headingPath.pop();
        headingPath.push(candidate.title);
      }
      const section = lines.slice(heading.line, end).join("\n").trimEnd();
      const codeBlocks = (section.match(/```[\s\S]*?```/g) ?? []).length;
      const commandLines = section.split(/\r?\n/).filter((line) => /^\s*(pnpm|npm|yarn|git|continuum)\s+/i.test(line.replace(/^\s*[-`]+/, ""))).length;
      return {
        name: headingPath.join(" > "),
        kind: "heading",
        content: section,
        startLine: heading.line + 1,
        endLine: end,
        metadata: {
          headingPath,
          codeBlockCount: codeBlocks,
          commandCount: commandLines,
          architectureDecision: /\b(decision|rationale|architecture)\b/i.test(heading.title),
          limitation: /\b(limitations?|unsupported|known issues?)\b/i.test(heading.title),
        },
      };
    });
  }
}
