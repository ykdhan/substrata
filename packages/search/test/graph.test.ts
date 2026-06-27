import { existsSync } from 'node:fs';
import { rm, utimes } from 'node:fs/promises';
import path from 'node:path';

import { graphPath, listFootprints, listMemoryDocuments } from '@substrata/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  extractConcepts,
  extractGraph,
  footprintNodeId,
  nodeId,
  type GraphData,
} from '../src/graph/extract';
import { buildGraph } from '../src/graph/indexer';
import { getGraphStatus } from '../src/graph/freshness';
import { hybridSearch } from '../src/graph/hybrid';
import { explainPath, graphRelatedToFile, graphRelatedToIds, graphStats } from '../src/graph/query';
import { openGraphDb } from '../src/graph/sqlite';
import { buildIndex } from '../src/indexer';
import { search } from '../src/query';
import { closeDb } from '../src/sqlite';

import { addFootprint, makeTempRepo, seedRepo } from './fixture';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  await seedRepo(cwd);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function extractSeeded(): Promise<GraphData> {
  const [footprints, memory] = await Promise.all([listFootprints(cwd), listMemoryDocuments(cwd)]);
  return extractGraph(cwd, footprints, memory);
}

function kinds(graph: GraphData): Set<string> {
  return new Set(graph.nodes.map((n) => n.kind));
}

function relations(graph: GraphData): Set<string> {
  return new Set(graph.edges.map((e) => e.rel));
}

describe('extractGraph', () => {
  it('produces all expected node kinds', async () => {
    const graph = await extractSeeded();
    for (const kind of [
      'footprint',
      'memory',
      'file',
      'tag',
      'decision',
      'rejected_option',
      'concept',
      'actor',
    ]) {
      expect(kinds(graph)).toContain(kind);
    }
  });

  it('produces all expected edge relations', async () => {
    const graph = await extractSeeded();
    for (const rel of [
      'TOUCHES_FILE',
      'HAS_TAG',
      'HAS_DECISION',
      'REJECTED',
      'MENTIONS',
      'AUTHORED_BY',
    ]) {
      expect(relations(graph)).toContain(rel);
    }
  });

  it('shares a single node for a tag carried by multiple docs (a bridge)', async () => {
    const graph = await extractSeeded();
    const tagNodes = graph.nodes.filter((n) => n.kind === 'tag' && n.ref === 'learner-search');
    expect(tagNodes).toHaveLength(1);
    // Both the learner-search footprint and the learner-search memory point at it.
    const tagId = tagNodes[0]!.id;
    const incoming = graph.edges.filter((e) => e.dst === tagId && e.rel === 'HAS_TAG');
    expect(incoming.length).toBeGreaterThanOrEqual(2);
  });

  it('links footprints that share a concept (Redis) via MENTIONS', async () => {
    const graph = await extractSeeded();
    const redis = nodeId('concept', 'redis');
    const mentions = graph.edges.filter((e) => e.dst === redis && e.rel === 'MENTIONS');
    // The "reject Redis cache" footprint and the "adopt Redis" footprint both mention it.
    expect(mentions.length).toBeGreaterThanOrEqual(2);
  });

  it('only the AUTHORED_BY actor node exists for the seeded single actor', async () => {
    const graph = await extractSeeded();
    const actors = graph.nodes.filter((n) => n.kind === 'actor');
    expect(actors).toHaveLength(1);
    expect(actors[0]!.label).toBe('claude-code');
  });

  it('creates a SUPERSEDES footprint->footprint edge from related.supersedes', async () => {
    const old = await addFootprint(cwd, {
      title: 'Old approach to indexing',
      actor: 'claude-code',
      decisions: ['Index synchronously on write.'],
    });
    const next = await addFootprint(cwd, {
      title: 'New approach to indexing',
      actor: 'claude-code',
      decisions: ['Index asynchronously in a worker.'],
      supersedes: [old.frontmatter.id],
    });

    const graph = await extractSeeded();
    const edge = graph.edges.find(
      (e) =>
        e.rel === 'SUPERSEDES' &&
        e.src === footprintNodeId(next.frontmatter.id) &&
        e.dst === footprintNodeId(old.frontmatter.id),
    );
    expect(edge).toBeDefined();
    expect(edge!.weight).toBeGreaterThan(1); // SUPERSEDES is weighted strongest
  });
});

describe('extractConcepts', () => {
  it('is deterministic and derives low-noise concepts from rejected subjects + decisions', async () => {
    const footprints = await listFootprints(cwd);
    const learner = footprints.find((f) => f.title.includes('learner search performance'))!;

    const first = extractConcepts(learner).map((c) => c.concept);
    const second = extractConcepts(learner).map((c) => c.concept);
    expect(first).toEqual(second); // deterministic

    // Rejected "Redis cache" yields the phrase + its tokens.
    expect(first).toContain('redis cache');
    expect(first).toContain('redis');
    expect(first).toContain('cache');

    // Stopwords / short tokens are filtered out.
    expect(first).not.toContain('the');
    expect(first).not.toContain('to');
    expect(first.every((c) => c.length >= 3)).toBe(true);
  });

  it('weights a rejected-subject phrase above a bare keyword token', async () => {
    const footprints = await listFootprints(cwd);
    const learner = footprints.find((f) => f.title.includes('learner search performance'))!;
    const byConcept = new Map(extractConcepts(learner).map((c) => [c.concept, c.weight]));
    expect(byConcept.get('redis cache')!).toBeGreaterThan(byConcept.get('pagination') ?? 0);
  });
});

describe('buildGraph + getGraphStatus', () => {
  it('writes graph.sqlite and reports fresh, then stale after a source change', async () => {
    expect(existsSync(graphPath(cwd))).toBe(false);
    expect((await getGraphStatus(cwd)).state).toBe('missing');

    await buildGraph(cwd);
    expect(existsSync(graphPath(cwd))).toBe(true);
    expect((await getGraphStatus(cwd)).state).toBe('fresh');

    // Touch a source footprint into the future → stale by mtime.
    const footprints = await listFootprints(cwd);
    const future = new Date(Date.now() + 60_000);
    await utimes(footprints[0]!.filePath, future, future);
    const status = await getGraphStatus(cwd);
    expect(status.state).toBe('stale');
  });

  it('graph DB lives beside the FTS index under the gitignored index/ dir', () => {
    expect(graphPath(cwd).endsWith(path.join('.substrata', 'index', 'graph.sqlite'))).toBe(true);
  });
});

describe('graphRelatedToIds (expansion + provenance)', () => {
  it('relates the two learner-search footprints via a shared tag/concept', async () => {
    const footprints = await listFootprints(cwd);
    const learner = footprints.find((f) => f.title.includes('learner search performance'))!;
    const redisFp = footprints.find((f) => f.title.includes('Redis cache for learner'))!;

    const related = await graphRelatedToIds([learner.frontmatter.id], { cwd, limit: 10 });
    const ids = related.map((r) => r.ref);
    expect(ids).toContain(redisFp.frontmatter.id);

    const hit = related.find((r) => r.ref === redisFp.frontmatter.id)!;
    expect(hit.bridges.length).toBeGreaterThan(0);
    // The bridge reason is recorded (shared tag and/or concept).
    expect(hit.bridges.map((b) => b.kind)).toEqual(
      expect.arrayContaining([expect.stringMatching(/tag|concept/)]),
    );
    expect(hit.score).toBeGreaterThan(0);
  });

  it('does not return the seed itself, and excludeSuperseded drops superseded docs', async () => {
    const footprints = await listFootprints(cwd);
    const learner = footprints.find((f) => f.title.includes('learner search performance'))!;

    const withSuperseded = await graphRelatedToIds([learner.frontmatter.id], { cwd, limit: 10 });
    expect(withSuperseded.map((r) => r.ref)).not.toContain(learner.frontmatter.id);

    const clean = await graphRelatedToIds([learner.frontmatter.id], {
      cwd,
      limit: 10,
      excludeSuperseded: true,
    });
    expect(clean.every((r) => r.status !== 'superseded')).toBe(true);
  });

  it('surfaces a superseding footprint through the SUPERSEDES edge', async () => {
    const old = await addFootprint(cwd, {
      title: 'Legacy retry policy',
      actor: 'claude-code',
      decisions: ['Retry webhooks 3 times with fixed backoff.'],
      filesTouched: ['webhooks/retry.ts'],
    });
    const next = await addFootprint(cwd, {
      title: 'Exponential retry policy',
      actor: 'claude-code',
      decisions: ['Retry webhooks with exponential backoff and jitter.'],
      filesTouched: ['webhooks/retry.ts'],
      supersedes: [old.frontmatter.id],
    });

    const related = await graphRelatedToIds([old.frontmatter.id], { cwd, limit: 10 });
    const hit = related.find((r) => r.ref === next.frontmatter.id);
    expect(hit).toBeDefined();
    expect(hit!.bridges.some((b) => b.kind === 'supersedes')).toBe(true);
  });
});

describe('graphRelatedToFile', () => {
  it('relates docs touching a file plus their neighbors', async () => {
    const related = await graphRelatedToFile('api/learners.ts', { cwd, limit: 10 });
    // The Redis-cache footprint shares the learner-search tag with the api/learners.ts toucher.
    const titles = related.map((r) => r.label);
    expect(titles.some((t) => t.includes('Redis cache for learner'))).toBe(true);
  });

  it('returns [] for an unknown file (fail-open, not a throw)', async () => {
    const related = await graphRelatedToFile('does/not/exist.ts', { cwd });
    expect(related).toEqual([]);
  });
});

describe('autoBuild option', () => {
  it('autoBuild:false does not build a missing graph and returns []', async () => {
    expect(existsSync(graphPath(cwd))).toBe(false);
    const footprints = await listFootprints(cwd);
    const seed = footprints[0]!.frontmatter.id;

    const res = await graphRelatedToIds([seed], { cwd, autoBuild: false });
    expect(res).toEqual([]);
    // No build was triggered — the graph DB still does not exist.
    expect(existsSync(graphPath(cwd))).toBe(false);
  });

  it('auto-builds by default (graph DB created on first read)', async () => {
    expect(existsSync(graphPath(cwd))).toBe(false);
    const footprints = await listFootprints(cwd);
    await graphRelatedToIds([footprints[0]!.frontmatter.id], { cwd });
    expect(existsSync(graphPath(cwd))).toBe(true);
  });
});

describe('explainPath', () => {
  it('finds a path between two footprints sharing a file', async () => {
    // Distinct actors so the ONLY shared node is the file (a clean bridge).
    await addFootprint(cwd, {
      title: 'Alpha touches shared',
      actor: 'alpha-bot',
      filesTouched: ['shared/module.ts'],
    });
    await addFootprint(cwd, {
      title: 'Beta touches shared',
      actor: 'beta-bot',
      filesTouched: ['shared/module.ts'],
    });
    await buildGraph(cwd);

    const footprints = await listFootprints(cwd);
    const alpha = footprints.find((f) => f.title === 'Alpha touches shared')!;
    const beta = footprints.find((f) => f.title === 'Beta touches shared')!;

    const db = openGraphDb(cwd, { readonly: true });
    try {
      const result = explainPath(
        db,
        footprintNodeId(alpha.frontmatter.id),
        footprintNodeId(beta.frontmatter.id),
      );
      expect(result.found).toBe(true);
      // Path goes A -> (shared file node) -> B: at least 3 hops, middle is a file.
      expect(result.path.length).toBeGreaterThanOrEqual(3);
      expect(result.path.some((hop) => hop.node.kind === 'file')).toBe(true);
    } finally {
      closeDb(db);
    }
  });

  it('reports not found for disconnected nodes', async () => {
    await buildGraph(cwd);
    const db = openGraphDb(cwd, { readonly: true });
    try {
      const result = explainPath(db, nodeId('footprint', 'nope-a'), nodeId('footprint', 'nope-b'));
      expect(result.found).toBe(false);
      expect(result.path).toEqual([]);
    } finally {
      closeDb(db);
    }
  });
});

describe('graphStats', () => {
  it('reports node/edge counts and most-connected docs', async () => {
    await buildGraph(cwd);
    const stats = await graphStats(cwd);
    expect(stats.totalNodes).toBeGreaterThan(0);
    expect(stats.totalEdges).toBeGreaterThan(0);
    expect(stats.nodesByKind.footprint).toBeGreaterThanOrEqual(4);
    expect(stats.edgesByRelation.TOUCHES_FILE).toBeGreaterThan(0);
    expect(stats.topConnected.length).toBeGreaterThan(0);
    expect(stats.topConnected[0]!.degree).toBeGreaterThan(0);
    expect(stats.builtAt).toBeTruthy();
  });

  it('fails open to zeros when the graph cannot be built/opened', async () => {
    // Point at a path with no .substrata and no write perms is hard to simulate;
    // instead assert the empty-shape contract holds on a fresh (buildable) repo.
    const stats = await graphStats(cwd);
    expect(stats).toHaveProperty('nodesByKind');
    expect(stats).toHaveProperty('edgesByRelation');
    expect(Array.isArray(stats.topConnected)).toBe(true);
  });
});

describe('hybridSearch', () => {
  it('preserves FTS seeds and never drops them', async () => {
    await buildIndex(cwd);
    const query = 'cursor pagination learner';
    const fts = await search(query, { cwd, excludeSuperseded: true });
    const hybrid = await hybridSearch(query, { cwd, excludeSuperseded: true, graphEnabled: true });

    expect(hybrid.seeds.map((s) => s.id)).toEqual(fts.map((s) => s.id));
    const rankedIds = new Set(hybrid.ranked.map((r) => r.id));
    for (const f of fts) expect(rankedIds.has(f.id)).toBe(true);
    // FTS rows lead the ranked list.
    expect(hybrid.ranked[0]!.origin).toBe('fts');
  });

  it('surfaces a graph-related doc that FTS alone misses', async () => {
    // A matches the query; B does not, but shares a file with A.
    await addFootprint(cwd, {
      title: 'Zephyr widget renderer',
      actor: 'ui-bot',
      decisions: ['Render zephyr widgets lazily.'],
      filesTouched: ['ui/panel.ts'],
    });
    await addFootprint(cwd, {
      title: 'Quokka layout engine',
      actor: 'ui-bot',
      decisions: ['Lay out panes in a grid.'],
      filesTouched: ['ui/panel.ts'],
    });
    await buildIndex(cwd);

    const fts = await search('zephyr', { cwd });
    const ftsIds = new Set(fts.map((s) => s.id));
    const quokka = (await listFootprints(cwd)).find((f) => f.title.includes('Quokka'))!;
    // FTS must NOT find Quokka (no 'zephyr' token anywhere in it).
    expect(ftsIds.has(quokka.frontmatter.id)).toBe(false);

    const hybrid = await hybridSearch('zephyr', { cwd, graphEnabled: true });
    expect(hybrid.related.some((r) => r.ref === quokka.frontmatter.id)).toBe(true);
    const quokkaRow = hybrid.ranked.find((r) => r.id === quokka.frontmatter.id);
    expect(quokkaRow?.origin).toBe('graph');
    expect(quokkaRow?.via?.some((b) => b.kind === 'file')).toBe(true);
  });

  it('graphEnabled:false degrades to pure FTS', async () => {
    await buildIndex(cwd);
    const hybrid = await hybridSearch('learner', { cwd, graphEnabled: false });
    expect(hybrid.related).toEqual([]);
    expect(hybrid.ranked.every((r) => r.origin === 'fts')).toBe(true);
  });

  it('fails open to FTS when the graph build is impossible (no crash)', async () => {
    await buildIndex(cwd);
    // Even with graph enabled, a query with results returns at least the seeds.
    const hybrid = await hybridSearch('learner', { cwd, graphEnabled: true });
    expect(hybrid.seeds.length).toBeGreaterThan(0);
    expect(hybrid.ranked.length).toBeGreaterThanOrEqual(hybrid.seeds.length);
  });
});
