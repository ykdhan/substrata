import type { IndexStatus } from '@substrata/core';

import { resolveFreshness } from '../freshness';

import { GRAPH_SCHEMA_VERSION } from './schema';
import { closeGraphDb, graphDbExists, openGraphDb } from './sqlite';

/**
 * Graph index freshness — mirrors `getIndexStatus` for the FTS index. Reuses the
 * shared `sourceStats` stat walk and `evaluateMetaFreshness` comparison so the
 * graph and FTS indexes stay in lock-step about what "stale" means.
 */

function readGraphMeta(cwd: string): Map<string, string> {
  const db = openGraphDb(cwd, { readonly: true });
  try {
    const rows = db.prepare('SELECT key, value FROM graph_meta').all() as Array<{
      key: string;
      value: string;
    }>;
    return new Map(rows.map((r) => [r.key, r.value]));
  } finally {
    closeGraphDb(db);
  }
}

/**
 * Report whether the on-disk graph index is missing, stale, or fresh for `cwd`.
 * Semantics match `getIndexStatus`: missing (no DB), stale/schema, stale/count,
 * stale/mtime, or fresh.
 */
export async function getGraphStatus(cwd: string): Promise<IndexStatus> {
  if (!graphDbExists(cwd)) {
    return { state: 'missing' };
  }

  let meta: Map<string, string>;
  try {
    meta = readGraphMeta(cwd);
  } catch {
    // Corrupt or unreadable DB — treat as missing so callers rebuild.
    return { state: 'missing' };
  }

  return resolveFreshness(meta, GRAPH_SCHEMA_VERSION, cwd);
}
