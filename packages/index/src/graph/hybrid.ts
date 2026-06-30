import type { SearchResult } from '@substrata/core';

import { search, type SearchOptions } from '../query';

import type { GraphBridge } from './query';
import { graphRelatedToIds, type GraphRelatedResult } from './query';

/**
 * Hybrid retrieval (graph-rag-implementation.md §5-§6): seed with FTS, then
 * expand through the graph to surface related decisions/files/memories the
 * keyword query alone would miss, and re-rank.
 *
 *   Query → FTS Search → Top Footprints → Graph Expansion → Related → Re-rank
 *
 * Strictly additive + fail-open: FTS seed results are NEVER dropped, and if the
 * graph is disabled, empty, or unavailable the output is exactly the FTS result.
 * Direct (FTS) matches lead the ranked list; graph-surfaced relations follow —
 * mirroring the plan's flow ("Top Footprints" first, "Related" after).
 */

export type HybridOrigin = 'fts' | 'graph';

export type HybridRanked = SearchResult & {
  /** 'fts' = matched the query directly; 'graph' = surfaced via expansion. */
  origin: HybridOrigin;
  /** Graph provenance (why this was surfaced), present for graph-origin rows. */
  via?: GraphBridge[];
};

export type HybridResult = {
  /** FTS seed matches that drove retrieval, in FTS rank order. */
  seeds: SearchResult[];
  /** Graph-expanded related docs (excludes seeds), in graph-relatedness order. */
  related: GraphRelatedResult[];
  /** Unified list: seeds first (FTS order), then related (graph order). */
  ranked: HybridRanked[];
};

export type HybridSearchOptions = SearchOptions & {
  /** Master switch; when false, hybrid degrades to pure FTS. */
  graphEnabled?: boolean;
  /** Max graph-related docs to attach (defaults to the FTS limit). */
  graphLimit?: number;
  /** Graph expansion bounds (forwarded to expandSeeds). */
  depth?: number;
  maxNodes?: number;
  maxEdges?: number;
  /** Skip the auto-(re)build of a stale/missing graph (default: build). */
  autoBuild?: boolean;
};

/** Map a graph-related candidate into a SearchResult-shaped ranked row. */
function relatedToRanked(r: GraphRelatedResult): HybridRanked {
  return {
    id: r.ref,
    title: r.label,
    filePath: r.filePath ?? '',
    score: r.score,
    snippet: '',
    tags: [],
    filesTouched: [],
    status: (r.status as SearchResult['status']) ?? 'completed',
    origin: 'graph',
    via: r.bridges,
  };
}

/**
 * Run hybrid retrieval for `query`. Always returns the FTS seeds; when the graph
 * is enabled and reachable, also returns graph-expanded relations + a unified
 * ranked list. Any graph failure falls back to FTS-only (never throws).
 */
export async function hybridSearch(
  query: string,
  options: HybridSearchOptions,
): Promise<HybridResult> {
  const seeds = await search(query, options);

  const ftsOnly: HybridResult = {
    seeds,
    related: [],
    ranked: seeds.map((s) => ({ ...s, origin: 'fts' as const })),
  };

  if (options.graphEnabled === false || seeds.length === 0) {
    return ftsOnly;
  }

  try {
    const graphLimit = options.graphLimit ?? options.limit ?? seeds.length;
    const related = await graphRelatedToIds(
      seeds.map((s) => s.id),
      {
        cwd: options.cwd,
        limit: graphLimit,
        depth: options.depth,
        maxNodes: options.maxNodes,
        maxEdges: options.maxEdges,
        excludeSuperseded: options.excludeSuperseded,
        autoBuild: options.autoBuild,
      },
    );

    // Defensive: expandSeeds already drops seeds, but a doc can be both an FTS
    // hit and graph-reachable — keep the FTS row, not a duplicate graph row.
    const seedIds = new Set(seeds.map((s) => s.id));
    const relatedFiltered = related.filter((r) => !seedIds.has(r.ref));

    const ranked: HybridRanked[] = [
      ...seeds.map((s) => ({ ...s, origin: 'fts' as const })),
      ...relatedFiltered.map(relatedToRanked),
    ];

    return { seeds, related: relatedFiltered, ranked };
  } catch {
    // Fail open: any graph error degrades to the FTS result.
    return ftsOnly;
  }
}
