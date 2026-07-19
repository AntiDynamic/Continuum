import type { Db } from "../connection.js";
import { now } from "@continuum/shared";
import type { ContextCandidate, ContextItem, ContextItemVersion, PersistedContextRelationship } from "@continuum/shared";

function isFtsUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("no such table: context_items_fts") ||
    message.includes("no such module: fts5")
  );
}

export interface ContextSearchResult {
  version: ContextItemVersion;
  score: number;
  rawScore?: number;
  backend?: "fts5" | "fallback_lexical";
}

export class ContextRepository {
  constructor(private readonly db: Db) {}

  upsertContextItem(
    repositoryId: number,
    kind: string,
    logicalKey: string
  ): ContextItem {
    const existing = this.db
      .prepare(
        "SELECT * FROM context_items WHERE repository_id = ? AND logical_key = ?"
      )
      .get(repositoryId, logicalKey) as ContextItem | undefined;

    if (existing) {
      return existing;
    }

    const id = crypto.randomUUID();
    const createdAt = now();

    this.db
      .prepare(
        "INSERT INTO context_items (id, repository_id, kind, logical_key, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(id, repositoryId, kind, logicalKey, createdAt);

    return {
      id,
      repository_id: repositoryId,
      kind,
      logical_key: logicalKey,
      created_at: createdAt,
    };
  }

  insertContextItemVersion(version: ContextItemVersion): void {
    const latest = this.findLatestItemVersion(version.context_item_id);
    if (latest?.content_hash === version.content_hash) {
      return;
    }
    this.db.exec("SAVEPOINT insert_context_version");
    try {
    this.db.prepare(
      `UPDATE context_item_versions
       SET valid_to_commit_exclusive = ?
       WHERE context_item_id = ? AND valid_to_commit_exclusive IS NULL`,
    ).run(version.valid_from_commit, version.context_item_id);

    const result = this.db
      .prepare(
        `INSERT INTO context_item_versions (
          id, context_item_id, content, contextual_header, compiled_content, title, source_path,
          source_start_line, source_end_line, symbol_name, language,
          content_hash, source_blob_hash, valid_from_commit,
          valid_to_commit_exclusive, indexed_at, provenance_json,
          staleness_status, staleness_reason, metadata_json
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`
      )
      .run(
        version.id,
        version.context_item_id,
        version.content,
        version.contextual_header ?? null,
        version.compiled_content ?? null,
        version.title ?? null,
        version.source_path,
        version.source_start_line,
        version.source_end_line,
        version.symbol_name ?? null,
        version.language,
        version.content_hash,
        version.source_blob_hash,
        version.valid_from_commit,
        version.valid_to_commit_exclusive ?? null,
        version.indexed_at,
        version.provenance_json ?? null,
        version.staleness_status,
        version.staleness_reason ?? null,
        version.metadata_json ?? null
      );

    // If FTS5 is available, insert into context_items_fts
    try {
      this.db
        .prepare(
          "INSERT INTO context_items_fts (rowid, content, title, symbol_name) VALUES (?, ?, ?, ?)"
        )
        .run(Number(result.lastInsertRowid), version.content, version.title ?? null, version.symbol_name ?? null);
      this.db
        .prepare(
          `INSERT INTO context_items_fts_v2(
             version_id, repository_id, title, symbol_name, source_path,
             contextual_header, content
           ) VALUES (
             ?, (SELECT repository_id FROM context_items WHERE id = ?),
             ?, ?, ?, ?, ?
           )`,
        )
        .run(
          version.id,
          version.context_item_id,
          version.title ?? "",
          version.symbol_name ?? "",
          version.source_path,
          version.contextual_header ?? "",
          version.compiled_content ?? version.content,
        );
    } catch (error: unknown) {
      if (!isFtsUnavailable(error)) {
        throw error;
      }
      }
      this.db.exec("RELEASE SAVEPOINT insert_context_version");
    } catch (error: unknown) {
      this.db.exec("ROLLBACK TO SAVEPOINT insert_context_version");
      this.db.exec("RELEASE SAVEPOINT insert_context_version");
      throw error;
    }
  }

  findLatestItemVersion(contextItemId: string): ContextItemVersion | undefined {
    return this.db
      .prepare(
        `SELECT * FROM context_item_versions 
         WHERE context_item_id = ? 
         ORDER BY indexed_at DESC, rowid DESC LIMIT 1`
      )
      .get(contextItemId) as ContextItemVersion | undefined;
  }

  searchContextItems(query: string, limit = 10, repositoryId?: number): ContextSearchResult[] {
    const ftsSearch = (query.match(/[\p{L}\p{N}_-]+/gu) ?? [])
      .map((term) => `"${term.replaceAll('"', '""')}"`)
      .join(" OR ");
    if (!ftsSearch) {
      return [];
    }

    const deduplicate = (
      results: ContextSearchResult[],
    ): ContextSearchResult[] => {
      const seen = new Set<string>();
      return results
        .filter(({ version }) => {
          const key = [
            version.source_path,
            version.source_start_line,
            version.source_end_line,
            version.content_hash,
          ].join(":");
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        })
        .slice(0, limit);
    };
    // Try FTS5 first
    try {
      const ftsQuery = `
        SELECT v.*, bm25(context_items_fts_v2) as score
        FROM context_items_fts_v2 fts
        JOIN context_item_versions v ON v.id = fts.version_id
        JOIN context_items c ON c.id = v.context_item_id
        WHERE context_items_fts_v2 MATCH ?
        AND v.valid_to_commit_exclusive IS NULL
        ${repositoryId !== undefined ? 'AND c.repository_id = ?' : ''}
        ORDER BY score
        LIMIT ?
      `;
      const stmt = this.db.prepare(ftsQuery);
      const params: (string | number)[] = [ftsSearch];
      if (repositoryId !== undefined) {
        params.push(repositoryId);
      }
      params.push(Math.max(limit * 4, limit));
      
      const rows = stmt.all(...params) as unknown as (ContextItemVersion & {
        score: number;
      })[];
      return deduplicate(rows.map(r => ({
        version: {
          id: r.id,
          context_item_id: r.context_item_id,
          content: r.content,
          contextual_header: r.contextual_header,
          compiled_content: r.compiled_content,
          title: r.title,
          source_path: r.source_path,
          source_start_line: r.source_start_line,
          source_end_line: r.source_end_line,
          symbol_name: r.symbol_name,
          language: r.language,
          content_hash: r.content_hash,
          source_blob_hash: r.source_blob_hash,
          valid_from_commit: r.valid_from_commit,
          valid_to_commit_exclusive: r.valid_to_commit_exclusive,
          indexed_at: r.indexed_at,
          provenance_json: r.provenance_json,
          staleness_status: r.staleness_status,
          staleness_reason: r.staleness_reason,
          metadata_json: r.metadata_json,
        },
        score: -r.score,
        rawScore: r.score,
        backend: "fts5" as const,
      })));
    } catch (error: unknown) {
      if (!isFtsUnavailable(error)) {
        throw error;
      }

      // Fallback to lexical LIKE search
      const likeQuery = `
        SELECT v.*
        FROM context_item_versions v
        JOIN context_items c ON c.id = v.context_item_id
        WHERE v.valid_to_commit_exclusive IS NULL
        ${repositoryId !== undefined ? 'AND c.repository_id = ?' : ''}
        ORDER BY v.indexed_at DESC
        LIMIT ?
      `;
      const stmt = this.db.prepare(likeQuery);
      const params: (string | number)[] = [];
      if (repositoryId !== undefined) {
        params.push(repositoryId);
      }
      params.push(Math.max(limit * 20, 500));
      
      const rows = stmt.all(...params) as unknown as ContextItemVersion[];
      const terms = (query.toLowerCase().match(/[a-z0-9_-]+/g) ?? []);
      return deduplicate(rows.map((version) => {
        const symbol = version.symbol_name?.toLowerCase() ?? "";
        const title = version.title?.toLowerCase() ?? "";
        const path = version.source_path.toLowerCase();
        const text = (version.compiled_content ?? version.content).toLowerCase();
        const overlap = terms.filter((term) => text.includes(term)).length / Math.max(1, terms.length);
        const score = Math.min(1, overlap * 0.45 + (terms.some((term) => symbol === term) ? 0.3 : 0) + (terms.some((term) => title.includes(term)) ? 0.15 : 0) + (terms.some((term) => path.includes(term)) ? 0.1 : 0));
        return {
          version,
          score,
          rawScore: score,
          backend: "fallback_lexical" as const,
        };
      }).filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score || a.version.id.localeCompare(b.version.id)));
    }
  }

  upsertRelationship(relationship: PersistedContextRelationship): void {
    const existing = this.db.prepare(
      `SELECT id FROM context_item_links
       WHERE source_item_id = ? AND target_item_id = ? AND relationship = ?`,
    ).get(
      relationship.sourceContextItemId,
      relationship.targetContextItemId,
      relationship.kind,
    ) as { id: string } | undefined;
    if (existing) {
      this.db.prepare(
        `UPDATE context_item_links
         SET confidence = ?, evidence_json = ? WHERE id = ?`,
      ).run(relationship.confidence, JSON.stringify(relationship.evidence), existing.id);
      return;
    }
    this.db.prepare(
      `INSERT INTO context_item_links(
         id, source_item_id, target_item_id, relationship, created_at,
         confidence, evidence_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      relationship.id,
      relationship.sourceContextItemId,
      relationship.targetContextItemId,
      relationship.kind,
      new Date().toISOString(),
      relationship.confidence,
      JSON.stringify(relationship.evidence),
    );
  }

  listRelatedVersions(contextItemId: string, limit = 5): ContextItemVersion[] {
    return this.db.prepare(
      `SELECT DISTINCT v.*
       FROM context_item_links l
       JOIN context_item_versions v
         ON v.context_item_id = CASE
           WHEN l.source_item_id = ? THEN l.target_item_id
           ELSE l.source_item_id
         END
       WHERE (l.source_item_id = ? OR l.target_item_id = ?)
         AND l.confidence IN ('high', 'medium')
         AND v.valid_to_commit_exclusive IS NULL
       ORDER BY CASE l.confidence WHEN 'high' THEN 0 ELSE 1 END, v.indexed_at DESC
       LIMIT ?`,
    ).all(contextItemId, contextItemId, contextItemId, limit) as unknown as ContextItemVersion[];
  }


  retireMissingCurrentVersions(repositoryId: number, currentContextItemIds: string[], closingCommit: string): void {
    this.db.exec("SAVEPOINT retire_missing_context");
    try {
      this.db.exec("CREATE TEMP TABLE IF NOT EXISTS continuum_current_items(id TEXT PRIMARY KEY); DELETE FROM continuum_current_items;");
      const insert = this.db.prepare("INSERT INTO continuum_current_items(id) VALUES(?)");
      for (const id of currentContextItemIds) insert.run(id);
      this.db.prepare(
        `UPDATE context_item_versions SET valid_to_commit_exclusive = ?
         WHERE valid_to_commit_exclusive IS NULL AND context_item_id IN (
           SELECT i.id FROM context_items i WHERE i.repository_id = ?
           AND NOT EXISTS (SELECT 1 FROM continuum_current_items c WHERE c.id = i.id)
         )`,
      ).run(closingCommit, repositoryId);
      this.db.exec("DROP TABLE continuum_current_items; RELEASE SAVEPOINT retire_missing_context");
    } catch (error: unknown) {
      this.db.exec("ROLLBACK TO SAVEPOINT retire_missing_context; RELEASE SAVEPOINT retire_missing_context");
      throw error;
    }
  }
  listCurrentVersions(repositoryId: number, limit = 500): ContextItemVersion[] {
    return this.db.prepare(
      `SELECT v.* FROM context_item_versions v
       JOIN context_items i ON i.id = v.context_item_id
       WHERE i.repository_id = ? AND v.valid_to_commit_exclusive IS NULL
       ORDER BY v.indexed_at DESC, v.rowid DESC LIMIT ?`,
    ).all(repositoryId, limit) as unknown as ContextItemVersion[];
  }

  findCurrentVersionsByTerms(repositoryId: number, terms: string[], limit = 200): ContextItemVersion[] {
    const bounded = [...new Set(terms.map((term) => term.toLowerCase()).filter((term) => term.length >= 3))].slice(0, 8);
    if (!bounded.length) return [];
    const predicates = bounded.map(() => "(LOWER(v.source_path) LIKE ? OR LOWER(COALESCE(v.symbol_name,'')) LIKE ? OR LOWER(COALESCE(v.title,'')) LIKE ?)").join(" OR ");
    const params = bounded.flatMap((term) => { const pattern = "%" + term + "%"; return [pattern, pattern, pattern]; });
    const exact = bounded.map(() => "?").join(",");
    const sql = "SELECT v.* FROM context_item_versions v JOIN context_items i ON i.id = v.context_item_id " +
      "WHERE i.repository_id = ? AND v.valid_to_commit_exclusive IS NULL AND (" + predicates + ") " +
      "ORDER BY CASE WHEN LOWER(COALESCE(v.symbol_name,'')) IN (" + exact + ") THEN 0 WHEN LOWER(v.source_path) LIKE ? THEN 1 ELSE 2 END, v.indexed_at DESC, v.rowid DESC LIMIT ?";
    return this.db.prepare(sql).all(repositoryId, ...params, ...bounded, "%" + bounded[0] + "%", limit) as unknown as ContextItemVersion[];
  }

  findVersionById(repositoryId: number, versionId: string): ContextItemVersion | undefined {
    return this.db.prepare(
      `SELECT v.* FROM context_item_versions v
       JOIN context_items i ON i.id = v.context_item_id
       WHERE i.repository_id = ? AND v.id = ?`,
    ).get(repositoryId, versionId) as ContextItemVersion | undefined;
  }

  recordCompilerRetrieval(params: {
    id: string;
    query: string;
    strategy: string;
    taskAnalysisJson: string;
    packetJson: string;
    candidates: ContextCandidate[];
    includedVersionIds?: string[];
  }): void {
    const included = new Set(params.includedVersionIds ?? []);
    this.db.exec("SAVEPOINT compiler_retrieval");
    try {
      this.db.prepare(
        `INSERT INTO context_retrievals(
           id, query, strategy, timestamp, budget_json, packet_json
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(params.id, params.query, params.strategy, new Date().toISOString(), params.taskAnalysisJson, params.packetJson);
      const evidence = this.db.prepare(
        `INSERT INTO context_retrieval_evidence(
           retrieval_id, item_version_id, search_backend, raw_lexical_score,
           normalized_lexical_score, score_components_json, reasons_json,
           coverage_json, estimated_tokens, final_rank, included,
           omission_reason, packet_section, strategy_version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      params.candidates.forEach((candidate, index) => {
        const isIncluded = included.has(candidate.item.id);
        evidence.run(
          params.id, candidate.item.id, candidate.lexicalEvidence.backend,
          candidate.lexicalEvidence.rawScore, candidate.lexicalEvidence.normalizedScore,
          JSON.stringify(candidate.components), JSON.stringify(candidate.reasons),
          JSON.stringify(candidate.coverageCategories), candidate.estimatedTokens,
          index + 1, isIncluded ? 1 : 0, isIncluded ? null : "not_selected",
          isIncluded ? "implementation" : "escalation", params.strategy,
          new Date().toISOString(),
        );
      });
      this.db.exec("RELEASE SAVEPOINT compiler_retrieval");
    } catch (error: unknown) {
      this.db.exec("ROLLBACK TO SAVEPOINT compiler_retrieval");
      this.db.exec("RELEASE SAVEPOINT compiler_retrieval");
      throw error;
    }
  }


  recordRetrieval(params: {
    id: string;
    runId?: string;
    query: string;
    strategy: string;
    packetJson?: string;
    items: { versionId: string; score: number; scoreComponentsJson: string; rank: number }[];
  }) {
    this.db.prepare(
      `INSERT INTO context_retrievals (id, run_id, query, strategy, timestamp, packet_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      params.id,
      params.runId ?? null,
      params.query,
      params.strategy,
      new Date().toISOString(),
      params.packetJson ?? null
    );

    const stmt = this.db.prepare(
      `INSERT INTO context_retrieval_items (retrieval_id, item_version_id, score, score_components_json, rank)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const item of params.items) {
      stmt.run(params.id, item.versionId, item.score, item.scoreComponentsJson, item.rank);
    }
  }
}
