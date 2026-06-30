import { stat } from 'node:fs/promises';

import {
  listFootprints,
  listMemoryDocuments,
  relativeToCwd,
  type Footprint,
  type MemoryDocument,
} from '@substrata/core';
import type Database from 'better-sqlite3';

import { applySchema, dropSchema, SCHEMA_VERSION } from './schema';
import { closeDb, openIndexDb } from './sqlite';

export type BuildIndexOptions = {
  /**
   * Reserved for API symmetry with the plan signature. The MVP performs a full
   * rebuild on every call (drop & recreate rows), so this flag is a no-op today
   * but kept so callers can pass it without breaking.
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

async function maxMtimeMs(filePaths: string[]): Promise<number> {
  let max = 0;
  for (const filePath of filePaths) {
    try {
      const st = await stat(filePath);
      if (st.mtimeMs > max) max = st.mtimeMs;
    } catch {
      // file vanished between listing and stat; ignore.
    }
  }
  return max;
}

function writeRows(db: Database.Database, rows: DocumentRow[]): void {
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

  for (const row of rows) {
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
  }
}

function writeMeta(
  db: Database.Database,
  meta: { sourceMaxMtime: number; sourceFileCount: number },
): void {
  const upsert = db.prepare(
    `INSERT INTO index_meta (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  upsert.run({ key: 'schema_version', value: String(SCHEMA_VERSION) });
  upsert.run({ key: 'built_at', value: new Date().toISOString() });
  upsert.run({ key: 'source_max_mtime', value: String(meta.sourceMaxMtime) });
  upsert.run({ key: 'source_file_count', value: String(meta.sourceFileCount) });
}

/**
 * Build (or fully rebuild) the search index for `cwd`. Loads footprints and
 * memory documents via `@substrata/core`, flattens each into one searchable
 * `documents` + `documents_fts` row, and records freshness metadata. The MVP
 * always does a full rebuild (drop & recreate rows) inside a transaction.
 */
export async function buildIndex(cwd: string, _options: BuildIndexOptions = {}): Promise<void> {
  const [footprints, memory] = await Promise.all([listFootprints(cwd), listMemoryDocuments(cwd)]);

  const rows: DocumentRow[] = [
    ...footprints.map((fp) => footprintToRow(cwd, fp)),
    ...memory.map((doc) => memoryToRow(cwd, doc)),
  ];

  const sourceFiles = [
    ...footprints.map((fp) => fp.filePath),
    ...memory.map((doc) => doc.filePath),
  ];
  const sourceMaxMtime = await maxMtimeMs(sourceFiles);

  const db = openIndexDb(cwd);
  try {
    const rebuild = db.transaction(() => {
      // Full rebuild: drop & recreate so a schema bump or removed source files
      // never leave stale rows behind.
      dropSchema(db);
      applySchema(db);
      writeRows(db, rows);
      writeMeta(db, { sourceMaxMtime, sourceFileCount: sourceFiles.length });
    });
    rebuild();
  } finally {
    closeDb(db);
  }
}
