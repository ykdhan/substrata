import type Database from 'better-sqlite3';

/**
 * SQLite index schema. See plan §11 ("SQLite schema").
 *
 * `documents` holds the structured row (for filtering + ranking inputs);
 * `documents_fts` is the FTS5 virtual table queried via MATCH; `index_meta`
 * carries freshness metadata (schema_version, built_at, source_max_mtime,
 * source_file_count) so the index can be detected as missing/stale/fresh
 * without re-parsing source files.
 */

/** Bump when the schema or indexing semantics change. */
export const SCHEMA_VERSION = 1;

const CREATE_DOCUMENTS = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT,
  created_at TEXT,
  updated_at TEXT,
  tags_json TEXT NOT NULL,
  files_json TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  work_type TEXT
);
`;

const CREATE_DOCUMENTS_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  id UNINDEXED,
  title,
  tags,
  files,
  content,
  tokenize = 'porter unicode61'
);
`;

const CREATE_INDEX_META = `
CREATE TABLE IF NOT EXISTS index_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Create all tables if they do not already exist. Idempotent. */
export function applySchema(db: Database.Database): void {
  db.exec(CREATE_DOCUMENTS);
  db.exec(CREATE_DOCUMENTS_FTS);
  db.exec(CREATE_INDEX_META);
}

/** Drop all index tables (used by a full rebuild). */
export function dropSchema(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS documents;');
  db.exec('DROP TABLE IF EXISTS documents_fts;');
  db.exec('DROP TABLE IF EXISTS index_meta;');
}
