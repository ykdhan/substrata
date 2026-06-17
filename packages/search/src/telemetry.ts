import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { accessLogPath, redactText } from '@substrata/core';
import Database from 'better-sqlite3';

/**
 * Local read/write access log (IMPROVEMENT_PLAN P1 / M2). Footprints are written
 * but we had no way to know whether they were ever *read*, so improvement was
 * unmeasurable. Each read appends one row here; `substrata stats` reports on it.
 *
 * Privacy: this DB is local and gitignored (it lives under `.substrata/index/`),
 * and nothing is ever transmitted. It is a SEPARATE file from the search index
 * so it is not wiped by an index rebuild.
 *
 * Logging is best-effort: failures are swallowed so telemetry can never break a
 * read path or a hook.
 */

export type AccessOp = 'context' | 'search' | 'list' | 'related';
export type AccessSource = 'cli' | 'mcp' | 'hook';

export type AccessEntry = {
  op: AccessOp;
  /** The query/task text, if any (omitted/blanked when store_queries is off). */
  query?: string;
  /** Number of results returned to the caller. */
  resultCount: number;
  /** Ids of the records returned (used for per-footprint hit counts). */
  returnedIds?: string[];
  source: AccessSource;
};

const CREATE_ACCESS_LOG = `
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  op TEXT NOT NULL,
  query TEXT,
  result_count INTEGER NOT NULL DEFAULT 0,
  returned_ids TEXT,
  source TEXT NOT NULL
);
`;
const CREATE_TS_INDEX = 'CREATE INDEX IF NOT EXISTS idx_access_ts ON access_log(ts);';

/** Cap stored query length so the log can't balloon on huge prompts. */
const MAX_QUERY_CHARS = 280;

function openAccessDb(cwd: string, readonly = false): Database.Database {
  const dbPath = accessLogPath(cwd);
  if (!readonly) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(CREATE_ACCESS_LOG);
    db.exec(CREATE_TS_INDEX);
    return db;
  }
  return new Database(dbPath, { readonly: true });
}

/**
 * Append one access row. `storeQuery` mirrors config.telemetry.store_queries;
 * when false only counts are kept. Never throws.
 */
export function logAccess(
  cwd: string,
  entry: AccessEntry,
  opts: { storeQuery?: boolean } = {},
): void {
  try {
    const db = openAccessDb(cwd);
    try {
      // Redact secret-pattern matches before persisting, then cap length. Query
      // storage is opt-in (telemetry.store_queries) and this is defense in depth.
      const query =
        opts.storeQuery !== false && entry.query
          ? redactText(entry.query).slice(0, MAX_QUERY_CHARS)
          : null;
      db.prepare(
        `INSERT INTO access_log (ts, op, query, result_count, returned_ids, source)
         VALUES (@ts, @op, @query, @resultCount, @returnedIds, @source)`,
      ).run({
        ts: new Date().toISOString(),
        op: entry.op,
        query,
        resultCount: entry.resultCount,
        returnedIds: entry.returnedIds ? JSON.stringify(entry.returnedIds) : null,
        source: entry.source,
      });
    } finally {
      db.close();
    }
  } catch {
    // Best-effort: telemetry must never break a read or a hook.
  }
}

export type AccessStats = {
  /** ISO cutoff applied (null = all time). */
  since: string | null;
  totalReads: number;
  byOp: Record<string, number>;
  bySource: Record<string, number>;
  /** Per-footprint hit counts (returned ids), most-referenced first. */
  hitsById: Array<{ id: string; hits: number }>;
};

type LogRow = { op: string; source: string; returned_ids: string | null };

/** Read aggregate access stats. `sinceDays` limits to the trailing N days. */
export function readStats(cwd: string, opts: { sinceDays?: number } = {}): AccessStats {
  const since =
    opts.sinceDays && opts.sinceDays > 0
      ? new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const empty: AccessStats = { since, totalReads: 0, byOp: {}, bySource: {}, hitsById: [] };

  let db: Database.Database;
  try {
    db = openAccessDb(cwd, true);
  } catch {
    return empty; // no log yet
  }

  try {
    const rows = (
      since
        ? db.prepare('SELECT op, source, returned_ids FROM access_log WHERE ts >= ?').all(since)
        : db.prepare('SELECT op, source, returned_ids FROM access_log').all()
    ) as LogRow[];

    const byOp: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const hits = new Map<string, number>();

    for (const row of rows) {
      byOp[row.op] = (byOp[row.op] ?? 0) + 1;
      bySource[row.source] = (bySource[row.source] ?? 0) + 1;
      if (row.returned_ids) {
        try {
          for (const id of JSON.parse(row.returned_ids) as string[]) {
            hits.set(id, (hits.get(id) ?? 0) + 1);
          }
        } catch {
          // skip malformed row
        }
      }
    }

    const hitsById = [...hits.entries()]
      .map(([id, h]) => ({ id, hits: h }))
      .sort((a, b) => b.hits - a.hits);

    return { since, totalReads: rows.length, byOp, bySource, hitsById };
  } catch {
    return empty;
  } finally {
    db.close();
  }
}
