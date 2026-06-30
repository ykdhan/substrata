import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { footprintsDir, memoryDir, relativeToCwd, type IndexStatus } from '@substrata/core';

import { SCHEMA_VERSION } from './schema';
import { closeDb, indexDbExists, openIndexDb } from './sqlite';

/**
 * Cheap stat walk of the footprint/memory dirs: collect the max mtime (ms) and
 * the count of `.md` files. No file contents are read or parsed — this mirrors
 * what `buildIndex` records so freshness can be checked without re-indexing.
 */
async function walkStats(dir: string): Promise<{ maxMtime: number; count: number }> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { maxMtime: 0, count: 0 };
  }

  let maxMtime = 0;
  let count = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await walkStats(full);
      if (sub.maxMtime > maxMtime) maxMtime = sub.maxMtime;
      count += sub.count;
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      count += 1;
      try {
        const st = await stat(full);
        if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
      } catch {
        // ignore unreadable file
      }
    }
  }
  return { maxMtime, count };
}

function readMeta(cwd: string): Map<string, string> {
  const db = openIndexDb(cwd, { readonly: true });
  try {
    const rows = db.prepare('SELECT key, value FROM index_meta').all() as Array<{
      key: string;
      value: string;
    }>;
    return new Map(rows.map((r) => [r.key, r.value]));
  } finally {
    closeDb(db);
  }
}

/** Combined stat walk of the footprint + memory dirs (count + max mtime ms). */
export async function sourceStats(cwd: string): Promise<{ count: number; maxMtime: number }> {
  const [fp, mem] = await Promise.all([walkStats(footprintsDir(cwd)), walkStats(memoryDir(cwd))]);
  return { count: fp.count + mem.count, maxMtime: Math.max(fp.maxMtime, mem.maxMtime) };
}

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

/**
 * Content signature of all source `.md` files (sorted by repo-relative path),
 * independent of filesystem mtimes. This is what lets a committed (shared) index
 * be recognized as fresh after a clone/pull, where checkout gives every file a
 * brand-new mtime even though the content is unchanged. Reads file bytes, so it
 * is only computed on the slow path (when the cheap mtime check says "stale").
 */
export async function sourceContentHash(cwd: string): Promise<string> {
  const files = [...(await walkMdFiles(footprintsDir(cwd))), ...(await walkMdFiles(memoryDir(cwd)))]
    .map((abs) => ({ abs, rel: relativeToCwd(cwd, abs) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const h = createHash('sha1');
  for (const { abs, rel } of files) {
    h.update(rel);
    h.update('\0');
    try {
      h.update(await readFile(abs, 'utf8'));
    } catch {
      // unreadable file: fold its absence into the hash deterministically.
    }
    h.update('\0');
  }
  return h.digest('hex');
}

/**
 * Pure freshness comparison shared by the FTS and graph indexes: given the
 * recorded `meta` map, the current schema version, and a fresh source stat
 * walk, decide whether the index is stale (schema/count/mtime) or fresh.
 */
export function evaluateMetaFreshness(
  meta: Map<string, string>,
  schemaVersion: number,
  source: { count: number; maxMtime: number },
): IndexStatus {
  const recordedSchema = Number(meta.get('schema_version'));
  if (!Number.isFinite(recordedSchema) || recordedSchema !== schemaVersion) {
    return { state: 'stale', reason: 'schema' };
  }

  const recordedCount = Number(meta.get('source_file_count'));
  if (!Number.isFinite(recordedCount) || recordedCount !== source.count) {
    return { state: 'stale', reason: 'count' };
  }

  const recordedMtime = Number(meta.get('source_max_mtime'));
  // Allow a 1ms tolerance for filesystem mtime granularity differences.
  if (!Number.isFinite(recordedMtime) || source.maxMtime > recordedMtime + 1) {
    return { state: 'stale', reason: 'mtime' };
  }

  return { state: 'fresh' };
}

/**
 * Freshness with a content-hash fallback shared by the FTS and graph indexes.
 * Runs the cheap mtime/count/schema comparison first; only when that reports
 * `stale/mtime` (the common false positive right after a clone, where checkout
 * bumps every file's mtime) does it pay to read the sources and compare a
 * content hash. If the content is byte-identical to what was indexed, the index
 * is genuinely fresh — so a committed (shared) DB is usable on clone with no
 * rebuild. A real content change leaves the hash mismatched and stays stale.
 */
export async function resolveFreshness(
  meta: Map<string, string>,
  schemaVersion: number,
  cwd: string,
): Promise<IndexStatus> {
  const status = evaluateMetaFreshness(meta, schemaVersion, await sourceStats(cwd));
  if (status.state !== 'stale' || status.reason !== 'mtime') return status;

  const recordedHash = meta.get('source_content_hash');
  if (recordedHash && (await sourceContentHash(cwd)) === recordedHash) {
    return { state: 'fresh' };
  }
  return status;
}

/**
 * Report whether the on-disk index is missing, stale, or fresh for `cwd`.
 *
 * - missing: no index DB file on disk.
 * - stale/schema: recorded schema_version differs from the current one.
 * - stale/count: the source `.md` file count changed.
 * - stale/mtime: a source file is newer than the recorded build mtime.
 * - fresh: otherwise.
 *
 * Comparison is against a cheap stat walk only (plan §11) — no parsing.
 */
export async function getIndexStatus(cwd: string): Promise<IndexStatus> {
  if (!indexDbExists(cwd)) {
    return { state: 'missing' };
  }

  let meta: Map<string, string>;
  try {
    meta = readMeta(cwd);
  } catch {
    // Corrupt or unreadable DB — treat as missing so callers rebuild.
    return { state: 'missing' };
  }

  return resolveFreshness(meta, SCHEMA_VERSION, cwd);
}
