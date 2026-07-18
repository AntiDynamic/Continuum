import type { ExtractedSymbol, Extractor } from "./types.js";

export class StatementSqlExtractor implements Extractor {
  extract(_absolutePath: string, content: string): ExtractedSymbol[] {
    const lines = content.split(/\r?\n/);
    const results: ExtractedSymbol[] = [];
    let buffer: string[] = [];
    let start = 1;
    const flush = (end: number): void => {
      const statement = buffer.join("\n").trim();
      buffer = [];
      if (!statement) return;
      const create = statement.match(/CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|VIEW|TRIGGER|VIRTUAL\s+TABLE)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([^\s("`\]]+)/i);
      const rollback = /\b(ROLLBACK|DOWN\s+MIGRATION|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(statement);
      const migration = /\b(ALTER\s+TABLE|PRAGMA\s+user_version|BEGIN\s+TRANSACTION|COMMIT)\b/i.test(statement);
      const constraint = /\b(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|NOT\s+NULL|REFERENCES)\b/i.test(statement);
      const type = create?.[1]?.toLowerCase().replace("virtual ", "") ?? (rollback ? "rollback" : migration ? "migration" : constraint ? "constraint" : "migration");
      const name = create?.[2] ?? `${type} at line ${start}`;
      results.push({ name, kind: type, content: statement, startLine: start, endLine: end, metadata: { parseConfidence: create ? "high" : "medium", statementType: type, rollback, constraint, columns: type === "table" ? [...statement.matchAll(/^\s*["`[]?([A-Za-z_][\w]*)["`\]]?\s+[A-Za-z]/gm)].map((match) => match[1]) : [] } });
    };
    lines.forEach((line, index) => {
      if (!buffer.length && !line.trim()) return;
      if (!buffer.length) start = index + 1;
      buffer.push(line);
      if (/;\s*(?:--.*)?$/.test(line)) flush(index + 1);
    });
    if (buffer.some((line) => line.trim())) flush(lines.length);
    return results;
  }
}
