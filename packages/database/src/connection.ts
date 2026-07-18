/**
 * Database connection wrapper using Node.js built-in node:sqlite.
 *
 * node:sqlite is available as an experimental built-in since Node.js 22.5.
 * It requires no native compilation, making it compatible with Node.js 24.x
 * without needing node-gyp or pre-built binaries.
 *
 * Architecture note: a third-party native driver was originally planned, but
 * native compilation is not always available in CI or fresh developer
 * environments. node:sqlite provides the synchronous API semantics needed here
 * with zero installation friction.
 *
 * The ExperimentalWarning emitted on stderr is suppressed via the
 * --no-experimental-sqlite flag or silenced via process.emitWarning override
 * when running in production mode.  Tests accept the warning.
 */

import { DatabaseSync } from "node:sqlite";

export type Db = InstanceType<typeof DatabaseSync>;

/** Open or create a Continuum SQLite database at the given path. */
export function openDatabase(dbPath: string): Db {
  const db = new DatabaseSync(dbPath);

  // Enable WAL for better concurrent read performance.
  db.exec("PRAGMA journal_mode = WAL");
  // Enforce foreign-key constraints — off by default in SQLite.
  db.exec("PRAGMA foreign_keys = ON");
  // Increase page cache to reduce I/O during event bursts.
  db.exec("PRAGMA cache_size = -8000");

  return db;
}

import { MIGRATIONS } from "./migrations.js";
import { now } from "@continuum/shared";

/**
 * Run pending migrations in version order.
 * Safe to call on every startup — already-applied migrations are skipped.
 */
export function migrate(db: Db): void {
  // Bootstrap the migrations table if this is a brand-new database.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      description TEXT    NOT NULL,
      applied_at  TEXT    NOT NULL
    );
  `);

  const appliedVersions = new Set<number>(
    (
      db
        .prepare("SELECT version FROM schema_migrations")
        .all() as { version: number }[]
    ).map((r) => r.version),
  );

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;

    // node:sqlite does not expose a transaction helper, so use BEGIN/COMMIT
    // explicitly.
    db.exec("BEGIN");
    try {
      if (migration.sql) {
        db.exec(migration.sql);
      }
      if (migration.up) {
        migration.up(db);
      }
      db
        .prepare(
          "INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.description, now());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

/** Return the current schema version. */
export function getSchemaVersion(db: Db): number {
  const row = db
    .prepare("SELECT MAX(version) as v FROM schema_migrations")
    .get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

import { SearchBackend } from "@continuum/shared";

/** 
 * Probe the SQLite connection for FTS5 capability.
 */
export function probeSearchCapability(db: Db): SearchBackend {
  try {
    db.exec("CREATE VIRTUAL TABLE temp.continuum_fts_probe USING fts5(content);");
    db.exec("DROP TABLE temp.continuum_fts_probe;");
    return "fts5";
  } catch (err) {
    return "fallback_lexical";
  }
}

