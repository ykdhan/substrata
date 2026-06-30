import type Database from 'better-sqlite3';

/**
 * SQLite graph index schema (graph-rag-implementation.md §1-§3).
 *
 * The graph is an AUXILIARY index built alongside the FTS index — it never
 * replaces FTS. `nodes` holds typed entities (footprint/memory/file/tag/
 * decision/rejected_option/concept/actor); `edges` holds typed, weighted
 * directed relationships between them; `graph_meta` carries freshness metadata
 * (schema_version, source_file_count, source_max_mtime) mirroring the FTS
 * `index_meta` so staleness can be detected from a cheap stat walk.
 */

/** Bump when the graph schema or extraction semantics change. */
export const GRAPH_SCHEMA_VERSION = 1;

const CREATE_NODES = `
CREATE TABLE IF NOT EXISTS nodes (
  id        TEXT PRIMARY KEY,
  kind      TEXT NOT NULL,
  label     TEXT NOT NULL,
  ref       TEXT,
  data_json TEXT
);
`;

const CREATE_EDGES = `
CREATE TABLE IF NOT EXISTS edges (
  src    TEXT NOT NULL,
  dst    TEXT NOT NULL,
  rel    TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (src, dst, rel)
);
`;

const CREATE_GRAPH_META = `
CREATE TABLE IF NOT EXISTS graph_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const CREATE_NODES_KIND_IDX = 'CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);';
const CREATE_EDGES_SRC_IDX = 'CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);';
const CREATE_EDGES_DST_IDX = 'CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);';

/** Create all graph tables + indexes if absent. Idempotent. */
export function applyGraphSchema(db: Database.Database): void {
  db.exec(CREATE_NODES);
  db.exec(CREATE_EDGES);
  db.exec(CREATE_GRAPH_META);
  db.exec(CREATE_NODES_KIND_IDX);
  db.exec(CREATE_EDGES_SRC_IDX);
  db.exec(CREATE_EDGES_DST_IDX);
}

/** Drop all graph tables (used by a full rebuild). */
export function dropGraphSchema(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS nodes;');
  db.exec('DROP TABLE IF EXISTS edges;');
  db.exec('DROP TABLE IF EXISTS graph_meta;');
}
