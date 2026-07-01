import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { graphPath } from '@substrata/core';
import Database from 'better-sqlite3';

import { closeDb } from '../sqlite';

import { applyGraphSchema, dropGraphSchema, GRAPH_SCHEMA_VERSION } from './schema';

/**
 * On-disk graph schema version, or null when there is no prior schema (fresh
 * DB). A schema bump (e.g. adding the `owner` column + its index to `edges`)
 * cannot be retrofitted onto an existing table by `CREATE ... IF NOT EXISTS`, so
 * an older schema must be dropped before applying the current one — otherwise
 * `CREATE INDEX ... ON edges(owner)` throws `no such column: owner` on open.
 */
function onDiskGraphSchemaVersion(db: Database.Database): number | null {
  try {
    const row = db.prepare(`SELECT value FROM graph_meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : null;
  } catch {
    return null; // graph_meta absent → fresh DB
  }
}

export type OpenGraphDbOptions = {
  /** Open the existing DB read-only; never create or migrate. */
  readonly?: boolean;
};

/**
 * Open (or create) the SQLite graph database at `@substrata/core`'s
 * `graphPath(cwd)`. Mirrors `openIndexDb` for the FTS index: the parent
 * `index/` directory is created if missing, and in read-write mode the schema
 * is applied idempotently so a freshly created file is immediately usable.
 *
 * In read-only mode the DB must already exist (better-sqlite3 throws otherwise);
 * the schema is left untouched.
 */
export function openGraphDb(cwd: string, options: OpenGraphDbOptions = {}): Database.Database {
  const dbPath = graphPath(cwd);

  if (!options.readonly) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath, { readonly: options.readonly ?? false });

  if (!options.readonly) {
    db.pragma('journal_mode = DELETE');
    const onDisk = onDiskGraphSchemaVersion(db);
    if (onDisk !== null && onDisk !== GRAPH_SCHEMA_VERSION) dropGraphSchema(db);
    applyGraphSchema(db);
  }

  return db;
}

/** True when a graph database file exists on disk for `cwd`. */
export function graphDbExists(cwd: string): boolean {
  return existsSync(graphPath(cwd));
}

/** Close a graph DB handle, ignoring errors from an already-closed handle. */
export function closeGraphDb(db: Database.Database): void {
  closeDb(db);
}
