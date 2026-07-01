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
  type ManifestDiff,
  type ManifestEntry,
  type SourceFile,
} from '../manifest';

import {
  BRIDGE_NODE_KINDS,
  extractFootprint,
  extractMemory,
  footprintNodeId,
  nodeId,
  type GraphData,
  type GraphEdge,
  type GraphNode,
} from './extract';
import { getGraphStatus } from './freshness';
import { applyGraphSchema, dropGraphSchema, GRAPH_SCHEMA_VERSION } from './schema';
import { closeGraphDb, openGraphDb } from './sqlite';

export type BuildGraphOptions = {
  /** Force a full drop-and-recreate rebuild instead of the incremental delta. */
  rebuild?: boolean;
};

/** Node kinds owned by exactly one doc (replaced wholesale on change). */
const OWNED_NODE_KINDS = new Set(['footprint', 'memory', 'rejected_option']);

/** Max source mtime, reused from the stats gathered during the diff. */
function maxMtime(fileStates: Map<string, FileState>): number {
  let max = 0;
  for (const st of fileStates.values()) if (st.mtimeMs > max) max = st.mtimeMs;
  return max;
}

function makeWriteNode(db: Database.Database): (node: GraphNode) => void {
  // Owned nodes (doc/rejected) are replaced so their data stays current; bridge
  // nodes are shared, so the first writer's label is kept (INSERT OR IGNORE) —
  // matching the full-rebuild dedup order.
  const replace = db.prepare(
    `INSERT INTO nodes (id, kind, label, ref, data_json) VALUES (@id, @kind, @label, @ref, @dataJson)
     ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, label=excluded.label, ref=excluded.ref, data_json=excluded.data_json`,
  );
  const ignore = db.prepare(
    `INSERT OR IGNORE INTO nodes (id, kind, label, ref, data_json) VALUES (@id, @kind, @label, @ref, @dataJson)`,
  );
  return (node: GraphNode): void => {
    const params = {
      id: node.id,
      kind: node.kind,
      label: node.label,
      ref: node.ref ?? null,
      dataJson: node.data ? JSON.stringify(node.data) : null,
    };
    (OWNED_NODE_KINDS.has(node.kind) ? replace : ignore).run(params);
  };
}

function makeWriteEdge(db: Database.Database): (edge: GraphEdge, owner: string) => void {
  const stmt = db.prepare(
    `INSERT INTO edges (src, dst, rel, weight, owner) VALUES (@src, @dst, @rel, @weight, @owner)
     ON CONFLICT(src, dst, rel) DO UPDATE SET weight=excluded.weight, owner=excluded.owner`,
  );
  return (edge: GraphEdge, owner: string): void => {
    stmt.run({ src: edge.src, dst: edge.dst, rel: edge.rel, weight: edge.weight, owner });
  };
}

/** Write one doc's full contribution (nodes + owner-tagged edges). */
function writeDocGraph(
  writeNode: (n: GraphNode) => void,
  writeEdge: (e: GraphEdge, owner: string) => void,
  ownerId: string,
  data: GraphData,
): void {
  for (const node of data.nodes) writeNode(node);
  for (const edge of data.edges) writeEdge(edge, ownerId);
}

function extractDoc(cwd: string, doc: Footprint | MemoryDocument, docType: DocType): GraphData {
  return docType === 'footprint'
    ? extractFootprint(cwd, doc as Footprint)
    : extractMemory(cwd, doc as MemoryDocument);
}

function docNodeId(docId: string, docType: DocType): string {
  return docType === 'footprint' ? footprintNodeId(docId) : nodeId('memory', docId);
}

function writeGraphMeta(
  db: Database.Database,
  meta: {
    sourceMaxMtime: number;
    sourceFileCount: number;
    sourceContentHash: string;
    builtAt: string;
  },
): void {
  const upsert = db.prepare(
    `INSERT INTO graph_meta (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  upsert.run({ key: 'schema_version', value: String(GRAPH_SCHEMA_VERSION) });
  upsert.run({ key: 'built_at', value: meta.builtAt });
  upsert.run({ key: 'source_max_mtime', value: String(meta.sourceMaxMtime) });
  upsert.run({ key: 'source_file_count', value: String(meta.sourceFileCount) });
  upsert.run({ key: 'source_content_hash', value: meta.sourceContentHash });
}

function readGraphSchemaVersion(db: Database.Database): number {
  try {
    const row = db.prepare(`SELECT value FROM graph_meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : NaN;
  } catch {
    return NaN;
  }
}

/** Latest source timestamp across footprint nodes (deterministic built_at). */
function builtAtFromGraph(db: Database.Database): string {
  const rows = db
    .prepare(`SELECT data_json FROM nodes WHERE kind IN ('footprint','memory')`)
    .all() as Array<{ data_json: string | null }>;
  let max = '';
  for (const r of rows) {
    if (!r.data_json) continue;
    try {
      const d = JSON.parse(r.data_json) as { created_at?: string; updated_at?: string };
      for (const t of [d.updated_at, d.created_at]) {
        if (t && t > max) max = t;
      }
    } catch {
      // skip malformed
    }
  }
  return max || '1970-01-01T00:00:00.000Z';
}

/** Remove bridge nodes that no longer participate in any edge. */
function cleanupOrphanNodes(db: Database.Database): void {
  const kinds = BRIDGE_NODE_KINDS.map((k) => `'${k}'`).join(',');
  db.exec(
    `DELETE FROM nodes WHERE kind IN (${kinds})
       AND id NOT IN (SELECT src FROM edges UNION SELECT dst FROM edges)`,
  );
}

/**
 * Build (or update) the graph index for `cwd`. INCREMENTAL by default (mirrors
 * the FTS indexer): only changed/added/removed docs are re-extracted, their
 * owner-tagged edges replaced, and orphaned bridge nodes cleaned up. SUPERSEDES
 * edges couple two docs, so an affected doc's supersede-neighbors are re-derived
 * too. A full drop-and-recreate rebuild runs on `rebuild`, no prior manifest, or
 * a schema-version mismatch.
 */
export async function buildGraph(cwd: string, options: BuildGraphOptions = {}): Promise<void> {
  const files = await listSourceFiles(cwd);

  const db = openGraphDb(cwd);
  try {
    const stored = readManifest(db);
    const { diff, fileHashes, fileStates } = await diffSources(files, stored);
    const contentHash = corpusHash(fileHashes);
    const sourceMaxMtime = maxMtime(fileStates);
    const incremental =
      !options.rebuild && stored.size > 0 && readGraphSchemaVersion(db) === GRAPH_SCHEMA_VERSION;

    if (!incremental) {
      await fullRebuild(db, cwd, files, fileStates, contentHash, sourceMaxMtime);
      return;
    }
    await incrementalUpdate(db, cwd, files, fileStates, stored, diff, contentHash, sourceMaxMtime);
  } finally {
    closeGraphDb(db);
  }
}

/** Build a manifest row from a source file + the diff's gathered stat/hash. */
function manifestRow(file: SourceFile, docId: string, fileStates: Map<string, FileState>) {
  const st = fileStates.get(file.relPath);
  return {
    relPath: file.relPath,
    hash: st?.hash ?? '',
    mtimeMs: st?.mtimeMs ?? 0,
    size: st?.size ?? 0,
    docId,
    docType: file.docType,
  };
}

async function fullRebuild(
  db: Database.Database,
  cwd: string,
  files: SourceFile[],
  fileStates: Map<string, FileState>,
  contentHash: string,
  sourceMaxMtime: number,
): Promise<void> {
  const [footprints, memory] = await Promise.all([listFootprints(cwd), listMemoryDocuments(cwd)]);
  const idByPath = new Map<string, { docId: string; docType: DocType }>();
  const contributions: Array<{ ownerId: string; data: GraphData }> = [];
  for (const fp of footprints) {
    idByPath.set(relativeToCwd(cwd, fp.filePath), {
      docId: fp.frontmatter.id,
      docType: 'footprint',
    });
    contributions.push({ ownerId: fp.frontmatter.id, data: extractFootprint(cwd, fp) });
  }
  for (const doc of memory) {
    idByPath.set(relativeToCwd(cwd, doc.filePath), {
      docId: doc.frontmatter.id,
      docType: 'memory',
    });
    contributions.push({ ownerId: doc.frontmatter.id, data: extractMemory(cwd, doc) });
  }

  const rebuild = db.transaction(() => {
    dropGraphSchema(db);
    applyGraphSchema(db);
    const writeNode = makeWriteNode(db);
    const writeEdge = makeWriteEdge(db);
    for (const { ownerId, data } of contributions)
      writeDocGraph(writeNode, writeEdge, ownerId, data);
    for (const file of files) {
      const info = idByPath.get(file.relPath);
      if (!info) continue;
      upsertManifestRow(db, manifestRow(file, info.docId, fileStates));
    }
    writeGraphMeta(db, {
      sourceMaxMtime,
      sourceFileCount: files.length,
      sourceContentHash: contentHash,
      builtAt: builtAtFromGraph(db),
    });
  });
  rebuild();
  db.exec('VACUUM');
}

async function incrementalUpdate(
  db: Database.Database,
  cwd: string,
  files: SourceFile[],
  fileStates: Map<string, FileState>,
  stored: Map<string, ManifestEntry>,
  diff: ManifestDiff,
  contentHash: string,
  sourceMaxMtime: number,
): Promise<void> {
  if (diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0) {
    // Content identical; refresh freshness + manifest stat rows so a mtime-only
    // touch (e.g. a clone/checkout) won't force a file read next time.
    const refresh = db.transaction(() => {
      for (const file of files) {
        const prev = stored.get(file.relPath);
        if (prev) upsertManifestRow(db, manifestRow(file, prev.docId, fileStates));
      }
      writeGraphMeta(db, {
        sourceMaxMtime,
        sourceFileCount: files.length,
        sourceContentHash: contentHash,
        builtAt: builtAtFromGraph(db),
      });
    });
    refresh();
    return;
  }

  const byPath = new Map(files.map((f) => [f.relPath, f]));
  const docIdToPath = new Map<string, { relPath: string; docType: DocType }>();
  for (const [relPath, entry] of stored) {
    docIdToPath.set(entry.docId, { relPath, docType: entry.docType });
  }

  // Affected doc ids/nodes: old ids (changed+removed, from manifest) + new ids.
  const affectedDocIds = new Set<string>();
  const affectedNodeIds = new Set<string>();
  const markAffected = (docId: string, docType: DocType): void => {
    affectedDocIds.add(docId);
    affectedNodeIds.add(docNodeId(docId, docType));
  };
  for (const rp of diff.changed) {
    const prev = stored.get(rp)!;
    markAffected(prev.docId, prev.docType);
  }
  for (const { relPath } of diff.removed) {
    const prev = stored.get(relPath);
    if (prev) markAffected(prev.docId, prev.docType);
  }

  // Parse added + changed docs.
  const parsed = await Promise.all(
    [...diff.added, ...diff.changed]
      .map((rp) => byPath.get(rp))
      .filter((f): f is SourceFile => Boolean(f))
      .map(async (file) => {
        const doc =
          file.docType === 'footprint'
            ? await parseFootprintFile(file.absPath)
            : await parseMemoryFile(file.absPath);
        const docId = doc.frontmatter.id;
        markAffected(docId, file.docType);
        return { file, docId, data: extractDoc(cwd, doc, file.docType) };
      }),
  );

  // Find supersede-neighbors: unaffected, still-present docs on the other end of
  // a SUPERSEDES edge touching an affected node. Their supersedes edges must be
  // re-derived because they may reference an affected/removed doc.
  const affectedList = [...affectedNodeIds];
  const supRows =
    affectedList.length > 0
      ? (db
          .prepare(
            `SELECT src, dst FROM edges WHERE rel='SUPERSEDES' AND (src IN (${affectedList
              .map(() => '?')
              .join(',')}) OR dst IN (${affectedList.map(() => '?').join(',')}))`,
          )
          .all(...affectedList, ...affectedList) as Array<{ src: string; dst: string }>)
      : [];
  const neighborFiles: SourceFile[] = [];
  const seenNeighbor = new Set<string>();
  for (const { src, dst } of supRows) {
    for (const node of [src, dst]) {
      if (!node.startsWith('footprint:')) continue;
      const docId = node.slice('footprint:'.length);
      if (affectedDocIds.has(docId) || seenNeighbor.has(docId)) continue;
      const loc = docIdToPath.get(docId);
      if (!loc || !byPath.has(loc.relPath)) continue; // gone / not on disk
      seenNeighbor.add(docId);
      neighborFiles.push(byPath.get(loc.relPath)!);
    }
  }
  const neighbors = await Promise.all(
    neighborFiles.map(async (file) => {
      const doc = await parseFootprintFile(file.absPath);
      return { file, docId: doc.frontmatter.id, data: extractDoc(cwd, doc, file.docType) };
    }),
  );

  const apply = db.transaction(() => {
    const writeNode = makeWriteNode(db);
    const writeEdge = makeWriteEdge(db);
    const affected = [...affectedDocIds];
    const affectedNodes = [...affectedNodeIds];
    const inList = (xs: string[]) => `(${xs.map(() => '?').join(',')})`;

    // 1. Remove non-SUPERSEDES edges owned by affected docs.
    if (affected.length > 0) {
      db.prepare(
        `DELETE FROM edges WHERE rel != 'SUPERSEDES' AND owner IN ${inList(affected)}`,
      ).run(...affected);
    }
    // 2. Remove SUPERSEDES edges touching an affected node (re-derived below).
    if (affectedNodes.length > 0) {
      db.prepare(
        `DELETE FROM edges WHERE rel='SUPERSEDES' AND (src IN ${inList(affectedNodes)} OR dst IN ${inList(
          affectedNodes,
        )})`,
      ).run(...affectedNodes, ...affectedNodes);
      // 3. Remove doc nodes + their rejected_option nodes for affected docs.
      db.prepare(`DELETE FROM nodes WHERE id IN ${inList(affectedNodes)}`).run(...affectedNodes);
    }
    if (affected.length > 0) {
      db.prepare(
        `DELETE FROM nodes WHERE kind='rejected_option' AND ref IN ${inList(affected)}`,
      ).run(...affected);
    }
    for (const { relPath } of diff.removed) deleteManifestRow(db, relPath);

    // 4. Re-insert added + changed + neighbor contributions.
    for (const { ownerId, data } of [
      ...parsed.map((p) => ({ ownerId: p.docId, data: p.data })),
      ...neighbors.map((n) => ({ ownerId: n.docId, data: n.data })),
    ]) {
      writeDocGraph(writeNode, writeEdge, ownerId, data);
    }

    // 5. Refresh manifest rows for added + changed.
    for (const p of parsed) {
      upsertManifestRow(db, manifestRow(p.file, p.docId, fileStates));
    }

    // 6. Drop now-orphaned bridge nodes.
    cleanupOrphanNodes(db);

    writeGraphMeta(db, {
      sourceMaxMtime,
      sourceFileCount: files.length,
      sourceContentHash: contentHash,
      builtAt: builtAtFromGraph(db),
    });
  });
  apply();
}

/**
 * Ensure the on-disk graph reflects current sources before querying. Mirrors the
 * FTS `ensureIndexFresh`: the graph DB is gitignored (absent right after clone),
 * so we (re)build on missing/stale.
 */
export async function ensureGraphFresh(cwd: string): Promise<void> {
  const status = await getGraphStatus(cwd);
  if (status.state !== 'fresh') {
    await buildGraph(cwd);
  }
}
