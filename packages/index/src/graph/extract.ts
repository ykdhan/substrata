import { relativeToCwd, toPosix, type Footprint, type MemoryDocument } from '@substrata/core';

/**
 * Pure graph extraction (graph-rag-implementation.md §2-§3): turn footprints and
 * memory documents into typed nodes + weighted directed edges. No I/O — every
 * function here is deterministic so it can be unit-tested in isolation and so a
 * rebuild produces byte-identical graphs for identical inputs.
 */

export type GraphNodeKind =
  | 'footprint'
  | 'memory'
  | 'file'
  | 'tag'
  | 'decision'
  | 'rejected_option'
  | 'concept'
  | 'actor';

export type GraphRelation =
  | 'TOUCHES_FILE'
  | 'HAS_TAG'
  | 'HAS_DECISION'
  | 'REJECTED'
  | 'MENTIONS'
  | 'AUTHORED_BY'
  | 'SUPERSEDES';

export type GraphNode = {
  /** Deterministic id of the form `${kind}:${key}`. */
  id: string;
  kind: GraphNodeKind;
  /** Human-readable label (original casing). */
  label: string;
  /** Back-reference: doc id for footprint/memory, path for file, etc. */
  ref?: string;
  /** Extra structured payload (serialized to data_json on write). */
  data?: Record<string, unknown>;
};

export type GraphEdge = {
  src: string;
  dst: string;
  rel: GraphRelation;
  weight: number;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/** Edge weights. SUPERSEDES is strongest — memory evolution is high signal. */
export const EDGE_WEIGHTS = {
  TOUCHES_FILE: 1,
  HAS_TAG: 1,
  HAS_DECISION: 1,
  REJECTED: 1,
  /** A rejected-option subject as a concept (high signal). */
  MENTIONS_PHRASE: 1,
  /** A single keyword token as a concept (lower signal). */
  MENTIONS_TOKEN: 0.6,
  AUTHORED_BY: 1,
  SUPERSEDES: 3,
} as const;

/** Build a deterministic node id. */
export function nodeId(kind: GraphNodeKind, key: string): string {
  return `${kind}:${key}`;
}

/** The footprint node id for a footprint frontmatter id. */
export function footprintNodeId(id: string): string {
  return nodeId('footprint', id);
}

/**
 * Stopwords stripped from concept extraction. Deliberately compact — these are
 * the connective tokens that would otherwise create high-degree, low-signal
 * concept hubs (e.g. every footprint "mentioning" the word "use").
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'for',
  'with',
  'use',
  'used',
  'using',
  'via',
  'instead',
  'over',
  'than',
  'this',
  'that',
  'these',
  'those',
  'our',
  'was',
  'were',
  'are',
  'not',
  'but',
  'from',
  'into',
  'onto',
  'off',
  'due',
  'per',
  'add',
  'added',
  'new',
  'old',
  'set',
  'get',
  'all',
  'any',
  'can',
  'will',
  'has',
  'have',
  'its',
  'their',
]);

/** Minimum length for a concept token (drops "a", "to", "of", "in"...). */
const MIN_TOKEN_LEN = 3;

/** Normalize text for hashing/keys: lowercase, collapse whitespace, trim. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Significant alphanumeric tokens of `text`, stopword- and length-filtered. */
function significantTokens(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t));
}

/**
 * FNV-1a 32-bit hash → 8-char hex. Used to give a decision node a stable,
 * content-derived id so two footprints stating the *same* decision share a
 * `decision:` node (and thus bridge in the graph).
 */
export function hashString(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Extract low-noise concepts from a footprint. Sources, in order of signal:
 *  - rejected-option subjects: the whole short label as one phrase concept
 *    ("redis cache"), plus its significant tokens ("redis", "cache").
 *  - decision text: significant tokens only (sentences are too noisy to phrase).
 *
 * Returns `{ concept, weight }` pairs; phrase concepts outweigh bare tokens.
 * Deterministic and dependency-free so it is trivially unit-testable.
 */
export function extractConcepts(fp: Footprint): Array<{ concept: string; weight: number }> {
  const out = new Map<string, number>();
  const add = (concept: string, weight: number): void => {
    const key = normalize(concept);
    if (key.length < MIN_TOKEN_LEN) return;
    // Keep the strongest weight seen for a concept.
    out.set(key, Math.max(out.get(key) ?? 0, weight));
  };

  for (const rejected of fp.sections.rejectedOptions ?? []) {
    const phrase = normalize(rejected.option);
    // Treat a short subject ("Redis cache", "offset pagination") as a unit.
    if (phrase.split(' ').length <= 4 && !STOPWORDS.has(phrase)) {
      add(phrase, EDGE_WEIGHTS.MENTIONS_PHRASE);
    }
    for (const token of significantTokens(rejected.option)) {
      add(token, EDGE_WEIGHTS.MENTIONS_TOKEN);
    }
  }

  for (const decision of fp.sections.decisions ?? []) {
    for (const token of significantTokens(decision)) {
      add(token, EDGE_WEIGHTS.MENTIONS_TOKEN);
    }
  }

  return [...out.entries()].map(([concept, weight]) => ({ concept, weight }));
}

/** Recency/status payload kept on a footprint node for ranking + rendering. */
function footprintData(cwd: string, fp: Footprint): Record<string, unknown> {
  const fm = fp.frontmatter;
  return {
    file_path: relativeToCwd(cwd, fp.filePath),
    status: fm.status,
    work_type: fm.work_type,
    created_at: fm.created_at,
    updated_at: fm.updated_at ?? null,
    actor: fm.actor,
  };
}

/**
 * Accumulates nodes (deduped by id) and edges (deduped by src|dst|rel, keeping
 * the strongest weight) so shared entities — a file touched by many footprints,
 * a tag carried by several — collapse to a single shared node that bridges them.
 */
class GraphBuilder {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();

  addNode(node: GraphNode): void {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, node);
  }

  addEdge(edge: GraphEdge): void {
    const key = `${edge.src}|${edge.dst}|${edge.rel}`;
    const existing = this.edges.get(key);
    if (!existing || edge.weight > existing.weight) this.edges.set(key, edge);
  }

  build(): GraphData {
    return { nodes: [...this.nodes.values()], edges: [...this.edges.values()] };
  }
}

function addFootprint(b: GraphBuilder, cwd: string, fp: Footprint): void {
  const fm = fp.frontmatter;
  const fpId = footprintNodeId(fm.id);
  b.addNode({
    id: fpId,
    kind: 'footprint',
    label: fp.title,
    ref: fm.id,
    data: footprintData(cwd, fp),
  });

  for (const file of fm.files_touched ?? []) {
    const posix = toPosix(file);
    const fileNode = nodeId('file', posix);
    b.addNode({ id: fileNode, kind: 'file', label: posix, ref: posix });
    b.addEdge({ src: fpId, dst: fileNode, rel: 'TOUCHES_FILE', weight: EDGE_WEIGHTS.TOUCHES_FILE });
  }

  for (const tag of fm.tags ?? []) {
    const key = normalize(tag);
    if (!key) continue;
    const tagNode = nodeId('tag', key);
    b.addNode({ id: tagNode, kind: 'tag', label: tag, ref: key });
    b.addEdge({ src: fpId, dst: tagNode, rel: 'HAS_TAG', weight: EDGE_WEIGHTS.HAS_TAG });
  }

  for (const decision of fp.sections.decisions ?? []) {
    const text = decision.trim();
    if (!text) continue;
    const decNode = nodeId('decision', hashString(normalize(text)));
    b.addNode({ id: decNode, kind: 'decision', label: text, data: { text } });
    b.addEdge({ src: fpId, dst: decNode, rel: 'HAS_DECISION', weight: EDGE_WEIGHTS.HAS_DECISION });
  }

  (fp.sections.rejectedOptions ?? []).forEach((rejected, i) => {
    const rejNode = nodeId('rejected_option', `${fm.id}#${i}`);
    b.addNode({
      id: rejNode,
      kind: 'rejected_option',
      label: rejected.option,
      ref: fm.id,
      data: { option: rejected.option, reason: rejected.reason, footprint: fm.id },
    });
    b.addEdge({ src: fpId, dst: rejNode, rel: 'REJECTED', weight: EDGE_WEIGHTS.REJECTED });
  });

  for (const { concept, weight } of extractConcepts(fp)) {
    const conNode = nodeId('concept', concept);
    b.addNode({ id: conNode, kind: 'concept', label: concept, ref: concept });
    b.addEdge({ src: fpId, dst: conNode, rel: 'MENTIONS', weight });
  }

  const actorKey = normalize(fm.actor);
  if (actorKey) {
    const actorNode = nodeId('actor', actorKey);
    b.addNode({ id: actorNode, kind: 'actor', label: fm.actor, ref: actorKey });
    b.addEdge({ src: fpId, dst: actorNode, rel: 'AUTHORED_BY', weight: EDGE_WEIGHTS.AUTHORED_BY });
  }

  // SUPERSEDES is canonical "newer → older". Capture both directions of the
  // recorded relationship so a half-recorded chain still links up: `supersedes`
  // points this footprint at what it replaces; `superseded_by` points the
  // replacement at this footprint.
  const related = fm.related ?? {};
  for (const oldId of related.supersedes ?? []) {
    b.addEdge({
      src: fpId,
      dst: footprintNodeId(oldId),
      rel: 'SUPERSEDES',
      weight: EDGE_WEIGHTS.SUPERSEDES,
    });
  }
  for (const newId of related.superseded_by ?? []) {
    b.addEdge({
      src: footprintNodeId(newId),
      dst: fpId,
      rel: 'SUPERSEDES',
      weight: EDGE_WEIGHTS.SUPERSEDES,
    });
  }
}

function addMemory(b: GraphBuilder, cwd: string, doc: MemoryDocument): void {
  const fm = doc.frontmatter;
  const memNode = nodeId('memory', fm.id);
  b.addNode({
    id: memNode,
    kind: 'memory',
    label: doc.title,
    ref: fm.id,
    data: {
      file_path: relativeToCwd(cwd, doc.filePath),
      updated_at: typeof fm.updated_at === 'string' ? fm.updated_at : null,
    },
  });

  const tags = Array.isArray(fm.tags) ? fm.tags : [];
  for (const tag of tags) {
    const key = normalize(tag);
    if (!key) continue;
    const tagNode = nodeId('tag', key);
    b.addNode({ id: tagNode, kind: 'tag', label: tag, ref: key });
    b.addEdge({ src: memNode, dst: tagNode, rel: 'HAS_TAG', weight: EDGE_WEIGHTS.HAS_TAG });
  }
}

/**
 * Extract the full graph for a repo from already-parsed footprints + memory.
 * Pure: takes `cwd` only to compute repo-relative source paths stored on nodes.
 */
export function extractGraph(
  cwd: string,
  footprints: Footprint[],
  memory: MemoryDocument[],
): GraphData {
  const b = new GraphBuilder();
  for (const fp of footprints) addFootprint(b, cwd, fp);
  for (const doc of memory) addMemory(b, cwd, doc);
  return b.build();
}

/**
 * Extract the nodes + edges contributed by a SINGLE footprint. Used by the
 * incremental graph builder, which needs each doc's own contribution (so its
 * edges can be tagged with an `owner` and removed precisely on change/removal).
 */
export function extractFootprint(cwd: string, fp: Footprint): GraphData {
  const b = new GraphBuilder();
  addFootprint(b, cwd, fp);
  return b.build();
}

/** Extract the nodes + edges contributed by a SINGLE memory document. */
export function extractMemory(cwd: string, doc: MemoryDocument): GraphData {
  const b = new GraphBuilder();
  addMemory(b, cwd, doc);
  return b.build();
}

/** Bridge node kinds (shared across docs) — cleaned up when orphaned. */
export const BRIDGE_NODE_KINDS: readonly GraphNodeKind[] = [
  'file',
  'tag',
  'decision',
  'concept',
  'actor',
];
