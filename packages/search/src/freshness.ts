import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { footprintsDir, memoryDir, type IndexStatus } from '@substrata/core';

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

  const recordedSchema = Number(meta.get('schema_version'));
  if (!Number.isFinite(recordedSchema) || recordedSchema !== SCHEMA_VERSION) {
    return { state: 'stale', reason: 'schema' };
  }

  const [fp, mem] = await Promise.all([walkStats(footprintsDir(cwd)), walkStats(memoryDir(cwd))]);
  const sourceCount = fp.count + mem.count;
  const sourceMaxMtime = Math.max(fp.maxMtime, mem.maxMtime);

  const recordedCount = Number(meta.get('source_file_count'));
  if (!Number.isFinite(recordedCount) || recordedCount !== sourceCount) {
    return { state: 'stale', reason: 'count' };
  }

  const recordedMtime = Number(meta.get('source_max_mtime'));
  // Allow a 1ms tolerance for filesystem mtime granularity differences.
  if (!Number.isFinite(recordedMtime) || sourceMaxMtime > recordedMtime + 1) {
    return { state: 'stale', reason: 'mtime' };
  }

  return { state: 'fresh' };
}
