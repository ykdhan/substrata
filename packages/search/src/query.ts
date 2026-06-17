import path from 'node:path';

import { toPosix, type FootprintStatus, type SearchResult, type WorkType } from '@substrata/core';
import type Database from 'better-sqlite3';

import { score } from './ranking';
import { closeDb, openIndexDb } from './sqlite';

export type SearchOptions = {
  cwd: string;
  limit?: number;
  /** Hard filter: only docs whose files_touched include one of these. */
  files?: string[];
  /** Hard filter: only docs carrying one of these tags. */
  tags?: string[];
  /** Drop superseded AND deprecated docs entirely. */
  excludeSuperseded?: boolean;
  /**
   * For `getRelatedToFile`: also surface footprints touching *neighbor* files
   * (siblings in the same directory), not just the exact file. Default on.
   */
  includeNeighbors?: boolean;
};

const DEFAULT_LIMIT = 8;

/**
 * Baseline relevance assigned to a direct file-hit in `getRelatedToFile` (these
 * rows do not come from an FTS MATCH, so they have no bm25). Chosen negative
 * (bm25 convention: lower is better) so a strong file match ranks comparably to
 * a good text match before the ×1.5 file-overlap boost is applied.
 */
const FILE_HIT_BM25 = -10;

/**
 * Baseline relevance for a NEIGHBOR hit (a doc touching a sibling file in the
 * same directory). Weaker than a direct file hit so exact matches always rank
 * first, but strong enough to surface relevant nearby work.
 */
const NEIGHBOR_BM25 = -4;

/** Posix dirname: the path up to (not including) the last slash, else "". */
function posixDir(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

/** Row joined from documents + the FTS match. */
type JoinedRow = {
  id: string;
  type: string;
  title: string;
  file_path: string;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  tags_json: string;
  files_json: string;
  work_type: string | null;
  bm25: number;
  snippet: string;
};

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Build a safe FTS5 MATCH expression from free-form user text. Each token is
 * wrapped in double quotes (with internal quotes doubled) so user punctuation
 * (e.g. `?!`, `:`, `-`) can never be interpreted as FTS5 query syntax. Tokens
 * are OR-ed so natural-language queries (e.g. "why did we avoid Redis?!") still
 * recall the relevant docs; ranking then orders by relevance. Returns null when
 * the query has no usable tokens.
 */
export function buildMatchQuery(query: string): string | null {
  const tokens = query
    .split(/[^A-Za-z0-9_]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

function rowToResult(row: JoinedRow, queryFiles: string[]): SearchResult {
  const tags = parseJsonArray(row.tags_json);
  const files = parseJsonArray(row.files_json);
  const status = (row.status ?? 'completed') as FootprintStatus;

  const ranked = score(
    {
      bm25: row.bm25,
      status: row.status as FootprintStatus | null,
      workType: row.work_type as WorkType | null,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      docFiles: files,
      queryFiles,
    },
    Date.now(),
  );

  return {
    id: row.id,
    title: row.title,
    filePath: row.file_path,
    score: ranked,
    snippet: row.snippet,
    tags,
    createdAt: row.created_at ?? undefined,
    filesTouched: files,
    status,
  };
}

type ExecuteOptions = {
  excludeSuperseded?: boolean;
  files?: string[];
  tags?: string[];
  limit: number;
};

/**
 * Run a MATCH query against an open DB, apply hard tag/file/status filters in
 * SQL, then rank + sort in JS. Shared by `search` and `getRelatedToFile`.
 */
function executeMatch(
  db: Database.Database,
  match: string,
  queryFiles: string[],
  options: ExecuteOptions,
): SearchResult[] {
  const where: string[] = [];
  const params: Record<string, unknown> = { match };

  if (options.excludeSuperseded) {
    // Memory docs have NULL status and are always kept; only footprint statuses
    // superseded/deprecated are dropped.
    where.push("(d.status IS NULL OR d.status NOT IN ('superseded', 'deprecated'))");
  }

  if (options.tags && options.tags.length > 0) {
    const clauses = options.tags.map((tag, i) => {
      params[`tag${i}`] = tag;
      return `EXISTS (SELECT 1 FROM json_each(d.tags_json) WHERE json_each.value = @tag${i})`;
    });
    where.push(`(${clauses.join(' OR ')})`);
  }

  if (options.files && options.files.length > 0) {
    const clauses = options.files.map((file, i) => {
      params[`file${i}`] = toPosix(file);
      return `EXISTS (SELECT 1 FROM json_each(d.files_json) WHERE json_each.value = @file${i})`;
    });
    where.push(`(${clauses.join(' OR ')})`);
  }

  const whereSql = where.length > 0 ? ` AND ${where.join(' AND ')}` : '';

  const sql = `
    SELECT
      d.id, d.type, d.title, d.file_path, d.status,
      d.created_at, d.updated_at, d.tags_json, d.files_json, d.work_type,
      bm25(documents_fts) AS bm25,
      snippet(documents_fts, 4, '[', ']', ' … ', 12) AS snippet
    FROM documents_fts
    JOIN documents d ON d.id = documents_fts.id
    WHERE documents_fts MATCH @match${whereSql}
  `;

  const rows = db.prepare(sql).all(params) as JoinedRow[];
  const results = rows.map((row) => rowToResult(row, queryFiles));
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, options.limit);
}

/**
 * Full-text search over footprints + memory. Builds a safe MATCH expression,
 * applies hard tag/file filters and optional superseded exclusion, ranks per
 * plan §11, and returns up to `limit` results.
 */
export async function search(query: string, options: SearchOptions): Promise<SearchResult[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const match = buildMatchQuery(query);
  if (!match) return [];

  const queryFiles = (options.files ?? []).map((f) => toPosix(f));

  const db = openIndexDb(options.cwd, { readonly: true });
  try {
    return executeMatch(db, match, queryFiles, {
      excludeSuperseded: options.excludeSuperseded,
      files: options.files,
      tags: options.tags,
      limit,
    });
  } finally {
    closeDb(db);
  }
}

/**
 * Find footprints/memory related to a specific file. Primary signal is a doc
 * whose `files_json` contains the posix-normalized path; an FTS fallback on the
 * filename stem broadens recall. Results are merged (dedup by id, file-hit
 * preferred) and ranked by the same rules.
 */
export async function getRelatedToFile(
  filePath: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const posixPath = toPosix(filePath);
  const stem = path.basename(posixPath).replace(/\.[^.]+$/, '');

  const db = openIndexDb(options.cwd, { readonly: true });
  try {
    // Hard file matches: docs whose files_touched contain the exact path.
    const fileRows = db
      .prepare(
        `SELECT
           d.id, d.type, d.title, d.file_path, d.status,
           d.created_at, d.updated_at, d.tags_json, d.files_json, d.work_type
         FROM documents d
         WHERE EXISTS (
           SELECT 1 FROM json_each(d.files_json) WHERE json_each.value = @path
         )`,
      )
      .all({ path: posixPath }) as Omit<JoinedRow, 'bm25' | 'snippet'>[];

    const byId = new Map<string, SearchResult>();
    for (const row of fileRows) {
      const joined: JoinedRow = { ...row, bm25: FILE_HIT_BM25, snippet: '' };
      // The file hit counts as overlap automatically: queryFiles includes
      // posixPath, so rowToResult applies the ×1.5 boost via the ranker.
      const result = rowToResult(joined, [posixPath]);
      byId.set(result.id, result);
    }

    // FTS fallback on the filename stem to broaden recall.
    const match = buildMatchQuery(stem);
    if (match) {
      const ftsResults = executeMatch(db, match, [posixPath], {
        excludeSuperseded: options.excludeSuperseded,
        tags: options.tags,
        limit: limit * 4,
      });
      for (const r of ftsResults) {
        if (!byId.has(r.id)) byId.set(r.id, r);
      }
    }

    // Neighbor pass: docs touching a sibling file in the same directory. Cheap
    // structural signal that broadens recall to nearby work (plan P2). Filtered
    // in JS so path matching is exact (no LIKE wildcard surprises).
    if (options.includeNeighbors !== false) {
      const dir = posixDir(posixPath);
      const allRows = db
        .prepare(
          `SELECT
             d.id, d.type, d.title, d.file_path, d.status,
             d.created_at, d.updated_at, d.tags_json, d.files_json, d.work_type
           FROM documents d`,
        )
        .all() as Omit<JoinedRow, 'bm25' | 'snippet'>[];

      for (const row of allRows) {
        if (byId.has(row.id)) continue;
        const files = parseJsonArray(row.files_json);
        const isNeighbor = files.some((f) => f !== posixPath && posixDir(f) === dir);
        if (!isNeighbor) continue;
        const joined: JoinedRow = { ...row, bm25: NEIGHBOR_BM25, snippet: '' };
        byId.set(row.id, rowToResult(joined, []));
      }
    }

    let merged = Array.from(byId.values());
    if (options.excludeSuperseded) {
      merged = merged.filter((r) => r.status !== 'superseded' && r.status !== 'deprecated');
    }
    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, limit);
  } finally {
    closeDb(db);
  }
}
