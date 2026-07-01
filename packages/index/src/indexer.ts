import {
  listFootprints,
  listMemoryDocuments,
  parseFootprintFile,
  parseMemoryFile,
  relativeToCwd,
  type Footprint,
  type MemoryDocument,
} from '@substrata/core';
import type Database from 'better-sqlite3';

import {
  corpusHash,
  deleteManifestRow,
  diffSources,
  listSourceFiles,
  readManifest,
  upsertManifestRow,
  type DocType,
  type FileState,
  type SourceFile,
} from './manifest';
import { applySchema, dropSchema, SCHEMA_VERSION } from './schema';
import { closeDb, openIndexDb } from './sqlite';

export type BuildIndexOptions = {
  /**
   * Force a full drop-and-recreate rebuild instead of the incremental delta
   * path. Used for the canonical deterministic build (e.g. `substrata index`)
   * and whenever the on-disk schema version doesn't match.
   */
  rebuild?: boolean;
};

/** Row shape inserted into the `documents` table. */
type DocumentRow = {
  id: string;
  type: 'footprint' | 'memory';
  title: string;
  filePath: string;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  tags: string[];
  files: string[];
  /** Full searchable content (joined sections / body). */
  content: string;
  workType: string | null;
};

function joinNonEmpty(parts: Array<string | undefined | null>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
    .join('\n\n');
}

/** Flatten a footprint into a single searchable document row. */
function footprintToRow(cwd: string, fp: Footprint): DocumentRow {
  const fm = fp.frontmatter;
  const s = fp.sections;

  const rejected = (s.rejectedOptions ?? []).map((r) => `${r.option}: ${r.reason}`).join('\n');

  const content = joinNonEmpty([
    fp.title,
    s.purpose,
    (s.decisions ?? []).join('\n'),
    rejected,
    s.implementationNotes,
    (s.memoryLearned ?? []).join('\n'),
    s.futureAgentGuidance,
    (fm.tags ?? []).join(' '),
    (fm.files_touched ?? []).join(' '),
  ]);

  return {
    id: fm.id,
    type: 'footprint',
    title: fp.title,
    filePath: relativeToCwd(cwd, fp.filePath),
    status: fm.status,
    createdAt: fm.created_at,
    updatedAt: fm.updated_at ?? null,
    tags: fm.tags ?? [],
    files: fm.files_touched ?? [],
    content,
    workType: fm.work_type,
  };
}

/** Flatten a memory document into a single searchable document row. */
function memoryToRow(cwd: string, doc: MemoryDocument): DocumentRow {
  const fm = doc.frontmatter;
  const tags = Array.isArray(fm.tags) ? fm.tags : [];

  const content = joinNonEmpty([doc.title, doc.body, tags.join(' ')]);

  return {
    id: fm.id,
    type: 'memory',
    title: doc.title,
    filePath: relativeToCwd(cwd, doc.filePath),
    status: null,
    createdAt: null,
    updatedAt: typeof fm.updated_at === 'string' ? fm.updated_at : null,
    tags,
    files: [],
    content,
    workType: null,
  };
}

/** Max source mtime, reused from the stats gathered during the diff. */
function maxMtime(fileStates: Map<string, FileState>): number {
  let max = 0;
  for (const st of fileStates.values()) if (st.mtimeMs > max) max = st.mtimeMs;
  return max;
}

function makeInsertRow(db: Database.Database): (row: DocumentRow) => void {
  const insertDoc = db.prepare(
    `INSERT INTO documents
       (id, type, title, file_path, status, created_at, updated_at, tags_json, files_json, raw_text, work_type)
     VALUES
       (@id, @type, @title, @filePath, @status, @createdAt, @updatedAt, @tagsJson, @filesJson, @content, @workType)`,
  );
  const insertFts = db.prepare(
    `INSERT INTO documents_fts (id, title, tags, files, content)
     VALUES (@id, @title, @tags, @files, @content)`,
  );
  return (row: DocumentRow): void => {
    insertDoc.run({
      id: row.id,
      type: row.type,
      title: row.title,
      filePath: row.filePath,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tagsJson: JSON.stringify(row.tags),
      filesJson: JSON.stringify(row.files),
      content: row.content,
      workType: row.workType,
    });
    insertFts.run({
      id: row.id,
      title: row.title,
      tags: row.tags.join(' '),
      files: row.files.join(' '),
      content: row.content,
    });
  };
}

/** Remove a doc's rows from both the structured + FTS tables. */
function makeDeleteRows(db: Database.Database): (id: string) => void {
  const delDoc = db.prepare('DELETE FROM documents WHERE id = ?');
  const delFts = db.prepare('DELETE FROM documents_fts WHERE id = ?');
  return (id: string): void => {
    delDoc.run(id);
    delFts.run(id);
  };
}

/**
 * Deterministic "built at" derived from the latest source timestamp (not the
 * wall clock), so rebuilding identical content produces identical metadata. A
 * wall-clock value would change every build and churn the committed (shared) DB.
 */
export function latestSourceTimestamp(
  rows: Array<{ createdAt: string | null; updatedAt: string | null }>,
): string {
  let max = '';
  for (const r of rows) {
    for (const t of [r.updatedAt, r.createdAt]) {
      if (t && t > max) max = t;
    }
  }
  return max || '1970-01-01T00:00:00.000Z';
}

/** Latest source timestamp across every row currently in the index. */
function builtAtFromDb(db: Database.Database): string {
  const rows = db
    .prepare('SELECT created_at AS createdAt, updated_at AS updatedAt FROM documents')
    .all() as Array<{
    createdAt: string | null;
    updatedAt: string | null;
  }>;
  return latestSourceTimestamp(rows);
}

function writeMeta(
  db: Database.Database,
  meta: {
    sourceMaxMtime: number;
    sourceFileCount: number;
    sourceContentHash: string;
    builtAt: string;
  },
): void {
  const upsert = db.prepare(
    `INSERT INTO index_meta (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  upsert.run({ key: 'schema_version', value: String(SCHEMA_VERSION) });
  upsert.run({ key: 'built_at', value: meta.builtAt });
  upsert.run({ key: 'source_max_mtime', value: String(meta.sourceMaxMtime) });
  upsert.run({ key: 'source_file_count', value: String(meta.sourceFileCount) });
  upsert.run({ key: 'source_content_hash', value: meta.sourceContentHash });
}

function readSchemaVersion(db: Database.Database): number {
  try {
    const row = db.prepare(`SELECT value FROM index_meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : NaN;
  } catch {
    return NaN;
  }
}

/** Parse one source file into its document row (footprint or memory). */
async function parseRow(cwd: string, file: SourceFile): Promise<DocumentRow> {
  if (file.docType === 'footprint') {
    return footprintToRow(cwd, await parseFootprintFile(file.absPath));
  }
  return memoryToRow(cwd, await parseMemoryFile(file.absPath));
}

/**
 * Build (or update) the search index for `cwd`. By default this is INCREMENTAL:
 * only the source files whose content changed since the last build are re-parsed
 * and re-indexed (detected via a per-file hash manifest), so the cost scales with
 * the size of the change, not the size of the corpus. A full drop-and-recreate
 * rebuild runs when `options.rebuild` is set, when there is no prior manifest, or
 * when the on-disk schema version differs.
 */
export async function buildIndex(cwd: string, options: BuildIndexOptions = {}): Promise<void> {
  const files = await listSourceFiles(cwd);

  const db = openIndexDb(cwd);
  try {
    const stored = readManifest(db);
    const { diff, fileHashes, fileStates } = await diffSources(files, stored);
    const contentHash = corpusHash(fileHashes);
    const sourceMaxMtime = maxMtime(fileStates);
    const manifestOf = (file: SourceFile, docId: string) => {
      const st = fileStates.get(file.relPath);
      return {
        relPath: file.relPath,
        hash: st?.hash ?? '',
        mtimeMs: st?.mtimeMs ?? 0,
        size: st?.size ?? 0,
        docId,
        docType: file.docType,
      };
    };
    const incremental =
      !options.rebuild && stored.size > 0 && readSchemaVersion(db) === SCHEMA_VERSION;

    if (!incremental) {
      const [footprints, memory] = await Promise.all([
        listFootprints(cwd),
        listMemoryDocuments(cwd),
      ]);
      const rows = [
        ...footprints.map((fp) => ({ row: footprintToRow(cwd, fp), type: 'footprint' as DocType })),
        ...memory.map((doc) => ({ row: memoryToRow(cwd, doc), type: 'memory' as DocType })),
      ];
      const rowByPath = new Map(rows.map((r) => [r.row.filePath, r]));
      const builtAt = latestSourceTimestamp(rows.map((r) => r.row));

      const rebuild = db.transaction(() => {
        dropSchema(db);
        applySchema(db);
        const insert = makeInsertRow(db);
        for (const { row } of rows) insert(row);
        for (const file of files) {
          const entry = rowByPath.get(file.relPath);
          if (!entry) continue;
          upsertManifestRow(db, manifestOf(file, entry.row.id));
        }
        writeMeta(db, {
          sourceMaxMtime,
          sourceFileCount: files.length,
          sourceContentHash: contentHash,
          builtAt,
        });
      });
      rebuild();
      db.exec('VACUUM');
      return;
    }

    // --- Incremental path ---
    if (diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0) {
      // Content is byte-identical; refresh freshness + manifest stat rows (a
      // mtime-only touch must not force a read/rebuild next time).
      const refresh = db.transaction(() => {
        for (const file of files) {
          const prev = stored.get(file.relPath);
          if (prev) upsertManifestRow(db, manifestOf(file, prev.docId));
        }
        writeMeta(db, {
          sourceMaxMtime,
          sourceFileCount: files.length,
          sourceContentHash: contentHash,
          builtAt: builtAtFromDb(db),
        });
      });
      refresh();
      return;
    }

    const byPath = new Map(files.map((f) => [f.relPath, f]));
    const toIndex = [...diff.added, ...diff.changed]
      .map((rp) => byPath.get(rp))
      .filter((f): f is SourceFile => Boolean(f));
    const parsed = await Promise.all(
      toIndex.map(async (file) => ({ file, row: await parseRow(cwd, file) })),
    );

    const apply = db.transaction(() => {
      const del = makeDeleteRows(db);
      const insert = makeInsertRow(db);
      // Drop rows for changed docs (by their previous id) and removed docs.
      for (const rp of diff.changed) {
        const prev = stored.get(rp);
        if (prev) del(prev.docId);
      }
      for (const { docId, relPath } of diff.removed) {
        del(docId);
        deleteManifestRow(db, relPath);
      }
      // Insert added + changed docs, refreshing their manifest rows.
      for (const { file, row } of parsed) {
        del(row.id); // guard against a stale row under the same id
        insert(row);
        upsertManifestRow(db, manifestOf(file, row.id));
      }
      writeMeta(db, {
        sourceMaxMtime,
        sourceFileCount: files.length,
        sourceContentHash: contentHash,
        builtAt: builtAtFromDb(db),
      });
    });
    apply();
  } finally {
    closeDb(db);
  }
}
