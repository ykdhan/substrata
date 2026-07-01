import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { footprintsDir, memoryDir, relativeToCwd } from '@substrata/core';
import type Database from 'better-sqlite3';

/**
 * Per-file source manifest — the enabler for INCREMENTAL indexing. Each index
 * (FTS + graph) records, per source `.md` file, its repo-relative path, a raw
 * content hash, and the doc id/type it produced. On a rebuild we hash the files
 * again (cheap — raw bytes, no markdown parse) and diff against the stored
 * manifest to learn exactly which docs were added / changed / removed, so only
 * that delta is re-parsed and re-indexed instead of the whole corpus.
 */

export type DocType = 'footprint' | 'memory';

export type ManifestEntry = {
  hash: string;
  mtimeMs: number;
  size: number;
  docId: string;
  docType: DocType;
};

/** Per-file stat + content hash gathered during a diff (drives manifest rows). */
export type FileState = { hash: string; mtimeMs: number; size: number };

export type ManifestDiff = {
  /** rel paths present now but not in the stored manifest. */
  added: string[];
  /** rel paths whose content hash changed. */
  changed: string[];
  /** rel paths in the stored manifest but gone from disk (with their doc ids). */
  removed: Array<{ relPath: string; docId: string }>;
};

/** Recursively collect absolute paths of every `.md` file under `dir`. */
async function walkMdFiles(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkMdFiles(full)));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Raw-byte content hash of one file (no markdown parse). */
async function hashFile(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  return createHash('sha1').update(buf).digest('hex');
}

export type SourceFile = { absPath: string; relPath: string; docType: DocType };

/** List every source `.md` file with its repo-relative path and doc type. */
export async function listSourceFiles(cwd: string): Promise<SourceFile[]> {
  const [fps, mems] = await Promise.all([
    walkMdFiles(footprintsDir(cwd)),
    walkMdFiles(memoryDir(cwd)),
  ]);
  return [
    ...fps.map((absPath) => ({
      absPath,
      relPath: relativeToCwd(cwd, absPath),
      docType: 'footprint' as const,
    })),
    ...mems.map((absPath) => ({
      absPath,
      relPath: relativeToCwd(cwd, absPath),
      docType: 'memory' as const,
    })),
  ];
}

/** Fresh raw-byte hash of every source file, keyed by repo-relative path. */
export async function hashSourceFiles(files: SourceFile[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const f of files) {
    try {
      out.set(f.relPath, await hashFile(f.absPath));
    } catch {
      // unreadable → treat as absent (folds deterministically into the diff).
    }
  }
  return out;
}

/**
 * Deterministic corpus signature derived from the per-file hashes (sorted by
 * repo-relative path). Both the build path and the freshness check derive the
 * corpus hash this way, so an incremental rebuild's recorded hash matches what a
 * later freshness check computes — no drift, no double read of file contents.
 */
export function corpusHash(fileHashes: Map<string, string>): string {
  const h = createHash('sha1');
  for (const relPath of [...fileHashes.keys()].sort()) {
    h.update(relPath);
    h.update('\0');
    h.update(fileHashes.get(relPath)!);
    h.update('\0');
  }
  return h.digest('hex');
}

/** Read the stored manifest from a DB. Empty when the table is absent (old schema). */
export function readManifest(db: Database.Database): Map<string, ManifestEntry> {
  try {
    const rows = db
      .prepare('SELECT rel_path, hash, mtime_ms, size, doc_id, doc_type FROM source_files')
      .all() as Array<{
      rel_path: string;
      hash: string;
      mtime_ms: number;
      size: number;
      doc_id: string;
      doc_type: DocType;
    }>;
    return new Map(
      rows.map((r) => [
        r.rel_path,
        { hash: r.hash, mtimeMs: r.mtime_ms, size: r.size, docId: r.doc_id, docType: r.doc_type },
      ]),
    );
  } catch {
    return new Map();
  }
}

export type DiffResult = {
  diff: ManifestDiff;
  /** Content hash of EVERY current file (reused stored hash when stat matched). */
  fileHashes: Map<string, string>;
  /** Fresh stat + hash per current file, for writing manifest rows. */
  fileStates: Map<string, FileState>;
};

/**
 * Diff the source tree against the stored manifest, stat-first: a file whose
 * (mtime, size) matches the manifest is assumed unchanged and is NOT read, so
 * the common "edited a couple of files" case reads only what actually changed
 * (O(changed), not O(corpus)). A stat mismatch triggers a content hash to
 * confirm — an mtime-only change (e.g. a clone/checkout) with identical bytes is
 * correctly classified as unchanged. Fully falls back to hashing when there is
 * no stored manifest.
 */
export async function diffSources(
  files: SourceFile[],
  stored: Map<string, ManifestEntry>,
): Promise<DiffResult> {
  const added: string[] = [];
  const changed: string[] = [];
  const fileHashes = new Map<string, string>();
  const fileStates = new Map<string, FileState>();

  for (const file of files) {
    let mtimeMs = 0;
    let size = 0;
    try {
      const st = await stat(file.absPath);
      mtimeMs = st.mtimeMs;
      size = st.size;
    } catch {
      // unreadable/vanished; fall through to a hash attempt (which folds absence in).
    }
    const prev = stored.get(file.relPath);

    if (prev && prev.mtimeMs === mtimeMs && prev.size === size) {
      // Stat unchanged → trust the stored hash without reading the file.
      fileHashes.set(file.relPath, prev.hash);
      fileStates.set(file.relPath, { hash: prev.hash, mtimeMs, size });
      continue;
    }

    // Stat differs (or new file): read + hash to know if content really changed.
    let hash = '';
    try {
      hash = createHash('sha1')
        .update(await readFile(file.absPath))
        .digest('hex');
    } catch {
      // unreadable → empty hash (deterministic); treated as content.
    }
    fileHashes.set(file.relPath, hash);
    fileStates.set(file.relPath, { hash, mtimeMs, size });

    if (!prev) added.push(file.relPath);
    else if (prev.hash !== hash) changed.push(file.relPath);
    // else: content identical, only mtime moved → not a reindex, but the manifest
    // row's mtime is refreshed via fileStates so the next diff skips the read.
  }

  const removed: Array<{ relPath: string; docId: string }> = [];
  const present = new Set(files.map((f) => f.relPath));
  for (const [relPath, entry] of stored) {
    if (!present.has(relPath)) removed.push({ relPath, docId: entry.docId });
  }

  return { diff: { added, changed, removed }, fileHashes, fileStates };
}

/** Upsert one manifest row (called as docs are (re)indexed). */
export function upsertManifestRow(
  db: Database.Database,
  entry: {
    relPath: string;
    hash: string;
    mtimeMs: number;
    size: number;
    docId: string;
    docType: DocType;
  },
): void {
  db.prepare(
    `INSERT INTO source_files (rel_path, hash, mtime_ms, size, doc_id, doc_type)
     VALUES (@relPath, @hash, @mtimeMs, @size, @docId, @docType)
     ON CONFLICT(rel_path) DO UPDATE SET
       hash = excluded.hash, mtime_ms = excluded.mtime_ms, size = excluded.size,
       doc_id = excluded.doc_id, doc_type = excluded.doc_type`,
  ).run(entry);
}

/** Delete one manifest row by rel path. */
export function deleteManifestRow(db: Database.Database, relPath: string): void {
  db.prepare('DELETE FROM source_files WHERE rel_path = ?').run(relPath);
}
