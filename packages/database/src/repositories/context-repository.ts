import type { Db } from "../connection.js";
import { now } from "@continuum/shared";
import type { ContextItem, ContextItemVersion } from "@continuum/shared";

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
    const result = this.db
      .prepare(
        `INSERT INTO context_item_versions (
          id, context_item_id, content, title, source_path,
          source_start_line, source_end_line, symbol_name, language,
          content_hash, source_blob_hash, valid_from_commit,
          valid_to_commit_exclusive, indexed_at, provenance_json,
          staleness_status, staleness_reason, metadata_json
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`
      )
      .run(
        version.id,
        version.context_item_id,
        version.content,
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
    } catch (err: any) {
      // Ignore if FTS5 table doesn't exist
    }
  }

  findLatestItemVersion(contextItemId: string): ContextItemVersion | undefined {
    return this.db
      .prepare(
        `SELECT * FROM context_item_versions 
         WHERE context_item_id = ? 
         ORDER BY indexed_at DESC LIMIT 1`
      )
      .get(contextItemId) as ContextItemVersion | undefined;
  }

  searchContextItems(query: string, limit = 10, repositoryId?: number): { version: ContextItemVersion; score: number }[] {
    // Try FTS5 first
    try {
      const ftsQuery = `
        SELECT v.*, bm25(context_items_fts) as score
        FROM context_items_fts fts
        JOIN context_item_versions v ON v.rowid = fts.rowid
        JOIN context_items c ON c.id = v.context_item_id
        WHERE context_items_fts MATCH ?
        ${repositoryId !== undefined ? 'AND c.repository_id = ?' : ''}
        ORDER BY score
        LIMIT ?
      `;
      const stmt = this.db.prepare(ftsQuery);
      const params: any[] = [query];
      if (repositoryId !== undefined) {
        params.push(repositoryId);
      }
      params.push(limit);
      
      const rows = stmt.all(...params) as any as (ContextItemVersion & { score: number })[];
      return rows.map(r => ({
        version: {
          id: r.id,
          context_item_id: r.context_item_id,
          content: r.content,
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
        score: Math.abs(r.score) // lower BM25 score is sometimes negative, but we'll use absolute/raw. Actually BM25 in sqlite gives more negative values for better matches.
      }));
    } catch (err: any) {
      console.error("FTS5 query failed", err);
      // Fallback to lexical LIKE search
      const likeQuery = `
        SELECT v.*
        FROM context_item_versions v
        JOIN context_items c ON c.id = v.context_item_id
        WHERE (v.content LIKE ? OR v.title LIKE ? OR v.symbol_name LIKE ?)
        ${repositoryId !== undefined ? 'AND c.repository_id = ?' : ''}
        ORDER BY v.indexed_at DESC
        LIMIT ?
      `;
      const stmt = this.db.prepare(likeQuery);
      const likeStr = `%${query}%`;
      const params: any[] = [likeStr, likeStr, likeStr];
      if (repositoryId !== undefined) {
        params.push(repositoryId);
      }
      params.push(limit);
      
      const rows = stmt.all(...params) as any as ContextItemVersion[];
      return rows.map(version => ({
        version,
        score: 1.0 // Arbitrary score for lexical fallback
      }));
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
