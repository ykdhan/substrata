import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { indexPath } from '@substrata/core';
import Database from 'better-sqlite3';

import { applySchema } from './schema';

export type OpenIndexDbOptions = {
  /** Open the existing DB read-only; never create or migrate. */
  readonly?: boolean;
};

/**
 * Open (or create) the SQLite index database at `@substrata/core`'s
 * `indexPath(cwd)`. The parent `index/` directory is created if missing.
 *
 * In read-only mode the DB must already exist (better-sqlite3 will throw
 * otherwise); the schema is left untouched. In read-write mode the schema is
 * applied idempotently so a freshly created file is immediately usable.
 */
export function openIndexDb(cwd: string, options: OpenIndexDbOptions = {}): Database.Database {
  const dbPath = indexPath(cwd);

  if (!options.readonly) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath, { readonly: options.readonly ?? false });

  if (!options.readonly) {
    db.pragma('journal_mode = DELETE');
    applySchema(db);
  }

  return db;
}

/** True when an index database file exists on disk for `cwd`. */
export function indexDbExists(cwd: string): boolean {
  return existsSync(indexPath(cwd));
}

/** Close a database handle, ignoring errors from an already-closed handle. */
export function closeDb(db: Database.Database): void {
  try {
    db.close();
  } catch {
    // already closed; nothing to do.
  }
}
