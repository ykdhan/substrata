import { stat } from 'node:fs/promises';

import { listFootprints, listMemoryDocuments } from '@substrata/core';
import type Database from 'better-sqlite3';

import { extractGraph, type GraphEdge, type GraphNode } from './extract';
import { getGraphStatus } from './freshness';
import { applyGraphSchema, dropGraphSchema, GRAPH_SCHEMA_VERSION } from './schema';
import { closeGraphDb, openGraphDb } from './sqlite';

/**
 * Graph index builder (graph-rag-implementation.md §1-§4). Loads footprints +
 * memory via `@substrata/core`, extracts typed nodes/edges, and writes them into
 * `graph.sqlite` inside a single transaction (full drop & recreate, like the FTS
 * indexer) so a schema bump or removed source files never leave stale rows.
 */

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

function writeNodes(db: Database.Database, nodes: GraphNode[]): void {
  const insert = db.prepare(
    `INSERT INTO nodes (id, kind, label, ref, data_json)
     VALUES (@id, @kind, @label, @ref, @dataJson)`,
  );
  for (const node of nodes) {
    insert.run({
      id: node.id,
      kind: node.kind,
      label: node.label,
      ref: node.ref ?? null,
      dataJson: node.data ? JSON.stringify(node.data) : null,
    });
  }
}

function writeEdges(db: Database.Database, edges: GraphEdge[]): void {
  const insert = db.prepare(
    `INSERT INTO edges (src, dst, rel, weight)
     VALUES (@src, @dst, @rel, @weight)`,
  );
  for (const edge of edges) {
    insert.run({ src: edge.src, dst: edge.dst, rel: edge.rel, weight: edge.weight });
  }
}

function writeGraphMeta(
  db: Database.Database,
  meta: { sourceMaxMtime: number; sourceFileCount: number },
): void {
  const upsert = db.prepare(
    `INSERT INTO graph_meta (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  upsert.run({ key: 'schema_version', value: String(GRAPH_SCHEMA_VERSION) });
  upsert.run({ key: 'built_at', value: new Date().toISOString() });
  upsert.run({ key: 'source_max_mtime', value: String(meta.sourceMaxMtime) });
  upsert.run({ key: 'source_file_count', value: String(meta.sourceFileCount) });
}

/**
 * Build (or fully rebuild) the graph index for `cwd`. Mirrors `buildIndex` for
 * the FTS side: parse sources, extract, and replace the graph atomically.
 */
export async function buildGraph(cwd: string): Promise<void> {
  const [footprints, memory] = await Promise.all([listFootprints(cwd), listMemoryDocuments(cwd)]);

  const { nodes, edges } = extractGraph(cwd, footprints, memory);

  const sourceFiles = [
    ...footprints.map((fp) => fp.filePath),
    ...memory.map((doc) => doc.filePath),
  ];
  const sourceMaxMtime = await maxMtimeMs(sourceFiles);

  const db = openGraphDb(cwd);
  try {
    const rebuild = db.transaction(() => {
      dropGraphSchema(db);
      applyGraphSchema(db);
      writeNodes(db, nodes);
      writeEdges(db, edges);
      writeGraphMeta(db, { sourceMaxMtime, sourceFileCount: sourceFiles.length });
    });
    rebuild();
  } finally {
    closeGraphDb(db);
  }
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
