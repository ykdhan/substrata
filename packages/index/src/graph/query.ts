import { toPosix } from '@substrata/core';
import type Database from 'better-sqlite3';

import { recencyBoost, statusPenalty } from '../ranking';
import { closeDb } from '../sqlite';

import { nodeId, type GraphNodeKind, type GraphRelation } from './extract';
import { ensureGraphFresh } from './indexer';
import { openGraphDb } from './sqlite';

/**
 * Graph query layer (graph-rag-implementation.md §6, §8, §9): expand from FTS
 * seed footprints to related docs through shared intermediate nodes, explain WHY
 * two docs are connected (shortest path), and report graph statistics.
 *
 * All public read functions auto-(re)build a stale/missing graph and FAIL OPEN —
 * any DB error degrades to an empty result, never an exception, so a corrupt or
 * absent graph can never break a retrieval path or a hook.
 */

/** Kinds of node that can bridge two docs during expansion. */
export type BridgeKind = 'file' | 'tag' | 'decision' | 'concept' | 'supersedes';

/** Map a bridge node kind to the `BridgeKind` label used in provenance. */
function bridgeKindOf(kind: GraphNodeKind): BridgeKind | null {
  switch (kind) {
    case 'file':
      return 'file';
    case 'tag':
      return 'tag';
    case 'decision':
      return 'decision';
    case 'concept':
      return 'concept';
    default:
      return null;
  }
}

/**
 * Relative weight of each bridge kind when scoring graph relatedness. A shared
 * file is the strongest structural signal; a shared tag the weakest; a direct
 * SUPERSEDES link is strongest of all (memory evolution).
 */
export const GRAPH_BRIDGE_WEIGHTS: Record<BridgeKind, number> = {
  supersedes: 1.5,
  file: 1,
  decision: 0.9,
  concept: 0.7,
  tag: 0.5,
};

/** Per-extra-hop multiplicative decay applied to a candidate's graph score. */
export const GRAPH_DISTANCE_DECAY = 0.5;

export type GraphBridge = {
  /** The seed (footprint) node id this candidate was reached from. */
  seedId: string;
  kind: BridgeKind;
  rel: GraphRelation;
  /** Bridge node label (file path / tag / concept / decision text), '' for supersedes. */
  label: string;
  bridgeNodeId?: string;
  weight: number;
};

export type GraphCandidate = {
  /** Node id (`footprint:<id>` or `memory:<id>`). */
  nodeId: string;
  kind: 'footprint' | 'memory';
  label: string;
  /** Underlying doc id. */
  ref: string;
  filePath?: string;
  /** Footprint status, when known (used for ranking + rendering). */
  status?: string;
  /** Footprint-hops from the nearest seed (1 = direct neighbor). */
  distance: number;
  bridges: GraphBridge[];
  data?: Record<string, unknown>;
};

export type ExpandOptions = {
  depth?: number;
  maxNodes?: number;
  maxEdges?: number;
};

type NodeInfo = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  ref: string | null;
  data: Record<string, unknown> | null;
};

function parseData(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Cached node lookups so a bounded BFS doesn't re-query the same node. */
class NodeCache {
  private readonly cache = new Map<string, NodeInfo | null>();
  private readonly stmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmt = db.prepare('SELECT id, kind, label, ref, data_json FROM nodes WHERE id = ?');
  }

  get(id: string): NodeInfo | null {
    if (this.cache.has(id)) return this.cache.get(id) ?? null;
    const row = this.stmt.get(id) as
      | { id: string; kind: string; label: string; ref: string | null; data_json: string | null }
      | undefined;
    const info: NodeInfo | null = row
      ? {
          id: row.id,
          kind: row.kind as GraphNodeKind,
          label: row.label,
          ref: row.ref,
          data: parseData(row.data_json),
        }
      : null;
    this.cache.set(id, info);
    return info;
  }
}

type EdgeRow = { other: string; rel: string; weight: number };

/**
 * Expand from seed footprint nodes to related docs (footprints/memory) through
 * shared bridge nodes and direct SUPERSEDES links. Returns one candidate per
 * discovered doc with full provenance (which bridges, which seed, distance).
 * Bounded by `depth`, `maxNodes`, and `maxEdges` so a dense graph stays cheap.
 */
export function expandSeeds(
  db: Database.Database,
  seedIds: string[],
  options: ExpandOptions = {},
): GraphCandidate[] {
  const depth = Math.max(1, options.depth ?? 1);
  const maxNodes = options.maxNodes ?? 40;
  const maxEdges = options.maxEdges ?? 80;

  const nodes = new NodeCache(db);
  const seeds = new Set(seedIds);

  // Outgoing bridge edges from a doc → intermediate node. AUTHORED_BY (actor)
  // and REJECTED (a per-footprint leaf) are excluded: an actor connects nearly
  // everything, and a rejected_option node belongs to a single footprint.
  const outBridges = db.prepare(
    `SELECT dst AS other, rel, weight FROM edges WHERE src = ? AND rel IN ('TOUCHES_FILE','HAS_TAG','HAS_DECISION','MENTIONS')`,
  );
  // Docs attached to an intermediate node (incoming edges).
  const intoBridge = db.prepare(
    `SELECT src AS other, rel, weight FROM edges WHERE dst = ? AND rel IN ('TOUCHES_FILE','HAS_TAG','HAS_DECISION','MENTIONS')`,
  );
  // Direct SUPERSEDES neighbors in either direction.
  const supersedes = db.prepare(
    `SELECT dst AS other, rel, weight FROM edges WHERE src = ? AND rel = 'SUPERSEDES'
     UNION
     SELECT src AS other, rel, weight FROM edges WHERE dst = ? AND rel = 'SUPERSEDES'`,
  );

  const candidates = new Map<string, GraphCandidate>();
  let edgesTraversed = 0;

  const recordBridge = (
    docId: string,
    distance: number,
    seedId: string,
    bridge: GraphBridge,
  ): void => {
    const info = nodes.get(docId);
    if (!info || (info.kind !== 'footprint' && info.kind !== 'memory')) return;
    let candidate = candidates.get(docId);
    if (!candidate) {
      if (candidates.size >= maxNodes) return;
      candidate = {
        nodeId: docId,
        kind: info.kind,
        label: info.label,
        ref: info.ref ?? docId,
        filePath: typeof info.data?.file_path === 'string' ? info.data.file_path : undefined,
        status: typeof info.data?.status === 'string' ? info.data.status : undefined,
        distance,
        bridges: [],
        data: info.data ?? undefined,
      };
      candidates.set(docId, candidate);
    }
    candidate.distance = Math.min(candidate.distance, distance);
    candidate.bridges.push(bridge);
  };

  let frontier = [...seeds];
  const expandedDocs = new Set<string>(seeds);

  for (let hop = 1; hop <= depth; hop += 1) {
    const next: string[] = [];
    for (const fpId of frontier) {
      if (edgesTraversed >= maxEdges || candidates.size >= maxNodes) break;

      // Direct supersedes neighbors.
      for (const row of supersedes.all(fpId, fpId) as EdgeRow[]) {
        if (edgesTraversed >= maxEdges) break;
        edgesTraversed += 1;
        recordBridge(row.other, hop, fpId, {
          seedId: fpId,
          kind: 'supersedes',
          rel: 'SUPERSEDES',
          label: '',
          weight: row.weight,
        });
        if (!expandedDocs.has(row.other)) {
          expandedDocs.add(row.other);
          next.push(row.other);
        }
      }

      // Bridge neighbors: fp → intermediate → other doc.
      for (const bridgeEdge of outBridges.all(fpId) as EdgeRow[]) {
        if (edgesTraversed >= maxEdges) break;
        edgesTraversed += 1;
        const bridge = nodes.get(bridgeEdge.other);
        if (!bridge) continue;
        const kind = bridgeKindOf(bridge.kind);
        if (!kind) continue;
        for (const back of intoBridge.all(bridgeEdge.other) as EdgeRow[]) {
          if (back.other === fpId) continue;
          if (edgesTraversed >= maxEdges) break;
          edgesTraversed += 1;
          recordBridge(back.other, hop, fpId, {
            seedId: fpId,
            kind,
            rel: bridgeEdge.rel as GraphRelation,
            label: bridge.label,
            bridgeNodeId: bridge.id,
            weight: Math.min(bridgeEdge.weight, back.weight),
          });
          if (!expandedDocs.has(back.other)) {
            expandedDocs.add(back.other);
            next.push(back.other);
          }
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  // Never return the seeds themselves as candidates.
  for (const seed of seeds) candidates.delete(seed);
  return [...candidates.values()];
}

/**
 * Pure graph relatedness score for a candidate: the sum of its bridge
 * contributions (kind weight × edge weight), decayed by graph distance and
 * modulated by recency + status — so a strongly-linked, recent, current doc
 * outranks a weakly-linked, old, or superseded one.
 */
export function scoreGraphCandidate(candidate: GraphCandidate, now: number = Date.now()): number {
  let bridgeSum = 0;
  for (const bridge of candidate.bridges) {
    bridgeSum += GRAPH_BRIDGE_WEIGHTS[bridge.kind] * bridge.weight;
  }
  const distanceFactor = Math.pow(GRAPH_DISTANCE_DECAY, Math.max(0, candidate.distance - 1));
  const updatedAt =
    typeof candidate.data?.updated_at === 'string' ? candidate.data.updated_at : null;
  const createdAt =
    typeof candidate.data?.created_at === 'string' ? candidate.data.created_at : null;
  const workType =
    typeof candidate.data?.work_type === 'string' ? (candidate.data.work_type as never) : null;

  let s = bridgeSum * distanceFactor;
  s *= recencyBoost(updatedAt ?? createdAt ?? undefined, workType, now);
  s *= statusPenalty((candidate.status as never) ?? null);
  return s;
}

export type GraphRelatedOptions = {
  cwd: string;
  limit?: number;
  depth?: number;
  maxNodes?: number;
  maxEdges?: number;
  /** Drop superseded/deprecated candidates. */
  excludeSuperseded?: boolean;
  /** Skip the auto-(re)build of a stale/missing graph (default: build). */
  autoBuild?: boolean;
};

export type GraphRelatedResult = GraphCandidate & { score: number };

const DEFAULT_LIMIT = 8;

/**
 * Find footprints/memory related to seed footprint id(s) through the graph.
 * Returns ranked candidates with provenance. Fails open to `[]`.
 */
export async function graphRelatedToIds(
  ids: string[],
  options: GraphRelatedOptions,
): Promise<GraphRelatedResult[]> {
  return withGraph(
    options.cwd,
    [],
    (db) => rankCandidates(expandSeeds(db, resolveSeedNodeIds(db, ids), options), options),
    { autoBuild: options.autoBuild },
  );
}

/**
 * Resolve doc ids (footprint or memory) to their graph node ids. A bare id is
 * looked up via `nodes.ref`; an already-qualified `kind:key` id passes through.
 * Falls back to the `footprint:` prefix when a doc has no node yet (dangling).
 */
function resolveSeedNodeIds(db: Database.Database, ids: string[]): string[] {
  const stmt = db.prepare(`SELECT id FROM nodes WHERE ref = ? AND kind IN ('footprint','memory')`);
  const out: string[] = [];
  for (const id of ids) {
    if (id.includes(':')) {
      out.push(id);
      continue;
    }
    const row = stmt.get(id) as { id: string } | undefined;
    out.push(row ? row.id : nodeId('footprint', id));
  }
  return out;
}

/**
 * Find footprints/memory related to a FILE: the docs that touch it (distance 0)
 * plus their graph neighbors. Fails open to `[]`.
 */
export async function graphRelatedToFile(
  filePath: string,
  options: GraphRelatedOptions,
): Promise<GraphRelatedResult[]> {
  const posix = toPosix(filePath);
  return withGraph(
    options.cwd,
    [],
    (db) => {
      const fileNode = nodeId('file', posix);
      const touchers = (
        db
          .prepare(`SELECT src FROM edges WHERE dst = ? AND rel = 'TOUCHES_FILE'`)
          .all(fileNode) as Array<{
          src: string;
        }>
      ).map((r) => r.src);
      if (touchers.length === 0) return [];

      // The docs touching the file are the primary results (distance 0); their
      // graph neighbors are secondary. Merge with touchers taking precedence.
      const byId = new Map<string, GraphCandidate>();
      for (const id of touchers) {
        const info = lookupNode(db, id);
        if (!info || (info.kind !== 'footprint' && info.kind !== 'memory')) continue;
        byId.set(id, {
          nodeId: id,
          kind: info.kind,
          label: info.label,
          ref: info.ref ?? id,
          filePath: typeof info.data?.file_path === 'string' ? info.data.file_path : undefined,
          status: typeof info.data?.status === 'string' ? info.data.status : undefined,
          distance: 0,
          bridges: [
            {
              seedId: fileNode,
              kind: 'file',
              rel: 'TOUCHES_FILE',
              label: posix,
              bridgeNodeId: fileNode,
              weight: 1,
            },
          ],
          data: info.data ?? undefined,
        });
      }
      for (const candidate of expandSeeds(db, touchers, options)) {
        if (!byId.has(candidate.nodeId)) byId.set(candidate.nodeId, candidate);
      }

      return rankCandidates([...byId.values()], options);
    },
    { autoBuild: options.autoBuild },
  );
}

function rankCandidates(
  candidates: GraphCandidate[],
  options: GraphRelatedOptions,
): GraphRelatedResult[] {
  const now = Date.now();
  let ranked = candidates.map((c) => ({ ...c, score: scoreGraphCandidate(c, now) }));
  if (options.excludeSuperseded) {
    ranked = ranked.filter((c) => c.status !== 'superseded' && c.status !== 'deprecated');
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, options.limit ?? DEFAULT_LIMIT);
}

export type ExplainHop = {
  node: { id: string; kind: GraphNodeKind; label: string };
  /** Relation traversed to REACH this node from the previous hop. */
  rel?: GraphRelation;
};

export type ExplainResult = {
  found: boolean;
  /** Alternating doc/bridge nodes from `fromId` to `toId`; empty when not found. */
  path: ExplainHop[];
};

/**
 * Shortest path between two nodes via undirected BFS over all edges, bounded by
 * `maxDepth` node-hops. Used by `substrata graph explain` to show WHY two docs
 * are connected (e.g. "A → shared file → B → shared decision → C").
 */
export function explainPath(
  db: Database.Database,
  fromId: string,
  toId: string,
  maxDepth = 6,
): ExplainResult {
  if (fromId === toId) {
    const info = lookupNode(db, fromId);
    return info
      ? { found: true, path: [{ node: { id: info.id, kind: info.kind, label: info.label } }] }
      : { found: false, path: [] };
  }

  // AUTHORED_BY is excluded: a shared author connects nearly everything, so a
  // path "A → same author → B" is noise, not an explanation. Explain traverses
  // the same meaningful relations expansion does (file/tag/decision/concept/
  // supersedes).
  const neighbors = db.prepare(
    `SELECT dst AS other, rel FROM edges WHERE src = ? AND rel != 'AUTHORED_BY'
     UNION
     SELECT src AS other, rel FROM edges WHERE dst = ? AND rel != 'AUTHORED_BY'`,
  );

  const parent = new Map<string, { prev: string; rel: GraphRelation }>();
  const visited = new Set<string>([fromId]);
  let frontier = [fromId];
  let found = false;

  for (let hop = 0; hop < maxDepth && !found && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const row of neighbors.all(current, current) as Array<{ other: string; rel: string }>) {
        if (visited.has(row.other)) continue;
        visited.add(row.other);
        parent.set(row.other, { prev: current, rel: row.rel as GraphRelation });
        if (row.other === toId) {
          found = true;
          break;
        }
        next.push(row.other);
      }
      if (found) break;
    }
    frontier = next;
  }

  if (!found) return { found: false, path: [] };

  // Reconstruct path from toId back to fromId.
  const chain: Array<{ id: string; rel?: GraphRelation }> = [];
  let cursor: string | undefined = toId;
  while (cursor && cursor !== fromId) {
    const link = parent.get(cursor);
    chain.push({ id: cursor, rel: link?.rel });
    cursor = link?.prev;
  }
  chain.push({ id: fromId });
  chain.reverse();

  const path: ExplainHop[] = chain.map((step) => {
    const info = lookupNode(db, step.id);
    return {
      node: {
        id: step.id,
        kind: (info?.kind ?? 'footprint') as GraphNodeKind,
        label: info?.label ?? step.id,
      },
      rel: step.rel,
    };
  });
  return { found: true, path };
}

/**
 * Convenience wrapper: ensure the graph is fresh, resolve `fromId`/`toId` doc
 * ids to node ids, and return the shortest explanatory path. Fails open to a
 * not-found result. Used by the `graph explain` CLI command + MCP tool.
 */
export async function explainGraphPath(
  cwd: string,
  fromId: string,
  toId: string,
  maxDepth = 6,
): Promise<ExplainResult> {
  return withGraph(cwd, { found: false, path: [] }, (db) => {
    const [from, to] = resolveSeedNodeIds(db, [fromId, toId]);
    return explainPath(db, from!, to!, maxDepth);
  });
}

function lookupNode(db: Database.Database, id: string): NodeInfo | null {
  const row = db
    .prepare('SELECT id, kind, label, ref, data_json FROM nodes WHERE id = ?')
    .get(id) as
    | { id: string; kind: string; label: string; ref: string | null; data_json: string | null }
    | undefined;
  return row
    ? {
        id: row.id,
        kind: row.kind as GraphNodeKind,
        label: row.label,
        ref: row.ref,
        data: parseData(row.data_json),
      }
    : null;
}

export type GraphStats = {
  totalNodes: number;
  totalEdges: number;
  nodesByKind: Record<string, number>;
  edgesByRelation: Record<string, number>;
  topConnected: Array<{ id: string; label: string; kind: string; degree: number }>;
  builtAt?: string;
};

/** Aggregate graph statistics for `substrata graph stats`. Fails open to zeros. */
export async function graphStats(cwd: string, opts: { topN?: number } = {}): Promise<GraphStats> {
  const empty: GraphStats = {
    totalNodes: 0,
    totalEdges: 0,
    nodesByKind: {},
    edgesByRelation: {},
    topConnected: [],
  };
  return withGraph(cwd, empty, (db) => {
    const topN = opts.topN ?? 5;
    const nodesByKind: Record<string, number> = {};
    for (const row of db
      .prepare('SELECT kind, COUNT(*) AS c FROM nodes GROUP BY kind')
      .all() as Array<{
      kind: string;
      c: number;
    }>) {
      nodesByKind[row.kind] = row.c;
    }
    const edgesByRelation: Record<string, number> = {};
    for (const row of db
      .prepare('SELECT rel, COUNT(*) AS c FROM edges GROUP BY rel')
      .all() as Array<{
      rel: string;
      c: number;
    }>) {
      edgesByRelation[row.rel] = row.c;
    }
    const totalNodes = Object.values(nodesByKind).reduce((a, b) => a + b, 0);
    const totalEdges = Object.values(edgesByRelation).reduce((a, b) => a + b, 0);

    const topConnected = db
      .prepare(
        `SELECT n.id, n.label, n.kind,
                (SELECT COUNT(*) FROM edges e WHERE e.src = n.id OR e.dst = n.id) AS degree
           FROM nodes n
          WHERE n.kind IN ('footprint','memory')
          ORDER BY degree DESC, n.id ASC
          LIMIT ?`,
      )
      .all(topN) as Array<{ id: string; label: string; kind: string; degree: number }>;

    const builtAtRow = db.prepare(`SELECT value FROM graph_meta WHERE key = 'built_at'`).get() as
      | { value: string }
      | undefined;

    return {
      totalNodes,
      totalEdges,
      nodesByKind,
      edgesByRelation,
      topConnected,
      builtAt: builtAtRow?.value,
    };
  });
}

/**
 * Ensure the graph is fresh, then run `fn` against a read-only handle. Any
 * failure (build error, corrupt DB, missing tables) returns `fallback` so the
 * graph layer is strictly fail-open. When `autoBuild` is false the freshness
 * (re)build is skipped — the query runs against whatever is on disk (and a
 * missing/stale graph simply falls back), honoring callers like
 * `graph context --no-auto-index`.
 */
async function withGraph<T>(
  cwd: string,
  fallback: T,
  fn: (db: Database.Database) => T,
  opts: { autoBuild?: boolean } = {},
): Promise<T> {
  if (opts.autoBuild !== false) {
    try {
      await ensureGraphFresh(cwd);
    } catch {
      return fallback;
    }
  }
  let db: Database.Database;
  try {
    db = openGraphDb(cwd, { readonly: true });
  } catch {
    return fallback;
  }
  try {
    return fn(db);
  } catch {
    return fallback;
  } finally {
    closeDb(db);
  }
}
