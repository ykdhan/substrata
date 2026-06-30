import {
  listFootprints,
  listMemoryDocuments,
  type Footprint,
  type SubstrataConfig,
} from '@substrata/core';
import { hybridSearch, renderGraphContext, search, type HybridResult } from '@substrata/index';

import { ensureFreshIndex } from '../commands/auto-index';
import { renderContext } from '../render/context';
import { recordAccess } from '../util';

/**
 * Context builders shared by the lifecycle hooks. Kept separate from the
 * `context` command so the hook path can apply its own token budget / relevance
 * threshold (config.hooks.*) without disturbing the user-facing command.
 */

/** Token budget for hook injection: hooks override, else the search default. */
function hookBudget(config: SubstrataConfig): number {
  return config.hooks.max_context_tokens ?? config.search.max_context_tokens;
}

/**
 * Search-backed context for a query (the user prompt, or branch+files at session
 * start). Returns null when nothing clears the relevance threshold so the hook
 * injects no noise.
 */
export async function buildHookContext(
  cwd: string,
  config: SubstrataConfig,
  opts: { query: string; files?: string[] },
): Promise<string | null> {
  if (!opts.query.trim()) return null;

  await ensureFreshIndex(cwd, true);

  const results = await search(opts.query, {
    cwd,
    limit: config.search.default_limit,
    files: opts.files && opts.files.length > 0 ? opts.files : undefined,
    excludeSuperseded: true,
  });

  const relevant = results.filter((r) => r.score >= config.hooks.min_score);
  if (relevant.length === 0) return null;

  const [footprints, memory] = await Promise.all([listFootprints(cwd), listMemoryDocuments(cwd)]);

  const rendered = renderContext(relevant, footprints, memory, hookBudget(config));
  if (rendered.sources.length === 0) return null;

  recordAccess(cwd, config, {
    op: 'context',
    query: opts.query,
    resultCount: rendered.sources.length,
    returnedIds: rendered.sources.map((s) => s.id),
    source: 'hook',
  });

  return rendered.text;
}

/**
 * Graph-aware variant of `buildHookContext` (graph-rag-implementation.md "Hook
 * 개선"): seed with FTS, expand through the graph, and render the enriched
 * sections. Same noise gate as the FTS path — at least one FTS SEED must clear
 * `hooks.min_score`, else returns null so the hook injects nothing. The graph
 * relations ride along only when a real query match anchors them.
 *
 * Returns null (not throw) on any failure so the caller can fall back to FTS.
 */
export async function buildGraphHookContext(
  cwd: string,
  config: SubstrataConfig,
  opts: { query: string; files?: string[] },
): Promise<string | null> {
  if (!opts.query.trim()) return null;

  await ensureFreshIndex(cwd, true);

  const hybrid = await hybridSearch(opts.query, {
    cwd,
    limit: config.search.default_limit,
    files: opts.files && opts.files.length > 0 ? opts.files : undefined,
    excludeSuperseded: true,
    graphEnabled: config.graph.enabled,
    graphLimit: config.search.default_limit,
    depth: config.graph.expansion_depth,
    maxNodes: config.graph.max_nodes,
    maxEdges: config.graph.max_edges,
  });

  const relevantSeedIds = new Set(
    hybrid.seeds.filter((s) => s.score >= config.hooks.min_score).map((s) => s.id),
  );
  if (relevantSeedIds.size === 0) return null;

  // A graph relation is only injected if it is anchored to a SURVIVING seed (one
  // that cleared min_score). A bridge's seedId is a node id (`footprint:<id>` /
  // `memory:<id>`); strip the kind prefix to compare against seed doc ids. This
  // keeps a raised min_score from leaking in relations whose anchor was dropped.
  const seedDocId = (nodeId: string): string => nodeId.slice(nodeId.indexOf(':') + 1);
  const anchoredToSurvivor = (bridges: HybridResult['related'][number]['bridges']): boolean =>
    bridges.some((b) => relevantSeedIds.has(seedDocId(b.seedId)));

  const filtered: HybridResult = {
    seeds: hybrid.seeds.filter((s) => relevantSeedIds.has(s.id)),
    related: hybrid.related.filter((r) => anchoredToSurvivor(r.bridges)),
    ranked: hybrid.ranked.filter((r) =>
      r.origin === 'graph'
        ? Boolean(r.via && anchoredToSurvivor(r.via))
        : relevantSeedIds.has(r.id),
    ),
  };

  const [footprints, memory] = await Promise.all([listFootprints(cwd), listMemoryDocuments(cwd)]);
  const rendered = renderGraphContext(
    opts.query,
    filtered,
    footprints,
    memory,
    hookBudget(config),
    config.search.default_limit,
  );
  if (rendered.sources.length === 0) return null;

  recordAccess(cwd, config, {
    op: 'context',
    query: opts.query,
    resultCount: rendered.sources.length,
    returnedIds: rendered.sources.map((s) => s.id),
    source: 'hook',
  });

  return rendered.text;
}

/** One-line gist of a footprint for the session-start awareness digest. */
function footprintGist(fp: Footprint): string {
  const s = fp.sections;
  const detail = s.decisions?.[0] ?? s.futureAgentGuidance ?? s.purpose;
  const trimmed = detail
    ?.split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return trimmed ? `${fp.title} — ${trimmed}` : fp.title;
}

/**
 * Awareness digest for SessionStart when there is no query to search on: the N
 * most recent (non-superseded) footprints, so a fresh session knows project
 * memory exists and what was last decided. Returns null when there are none.
 */
export async function recentDigest(
  cwd: string,
  config: SubstrataConfig,
  limit = 3,
): Promise<string | null> {
  const footprints = (await listFootprints(cwd)).filter(
    (fp) => fp.frontmatter.status !== 'superseded' && fp.frontmatter.status !== 'deprecated',
  );
  if (footprints.length === 0) return null;

  const chosen = footprints.slice(0, limit);
  recordAccess(cwd, config, {
    op: 'list',
    resultCount: chosen.length,
    returnedIds: chosen.map((fp) => fp.frontmatter.id),
    source: 'hook',
  });

  const lines = chosen.map((fp, i) => `${i + 1}. ${footprintGist(fp)}`);
  const more =
    footprints.length > limit
      ? `\n(+${footprints.length - limit} more — search with substrata_context / \`substrata context\`.)`
      : '';
  return `Recent Substrata project memory:\n\n${lines.join('\n')}${more}`;
}
