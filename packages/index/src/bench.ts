import { performance } from 'node:perf_hooks';

import { listFootprints, listMemoryDocuments } from '@substrata/core';

import { hybridSearch } from './graph/hybrid';
import { estimateTokens, renderGraphContext } from './graph/render';

/**
 * Token/latency benchmark: quantifies what the index buys over the naive
 * alternative an agent falls back to WITHOUT Substrata — reading every footprint
 * and memory file to find relevant context.
 *
 *   baseline  = read the whole .substrata markdown corpus (what a no-index agent
 *               dumps into its context window).
 *   substrata = FTS+graph retrieval rendered within the token budget (only the
 *               relevant, ranked slice).
 *
 * Tokens use `estimateTokens` (ceil(chars / 3.5)) — the SAME estimator the
 * context renderer uses — so the two sides are measured identically. The index
 * must already be built (callers run `buildIndex` first); retrieval here never
 * mutates it.
 */

export type BenchQueryResult = {
  query: string;
  /** Tokens an agent would read with no index (the whole corpus). */
  baselineTokens: number;
  /** Tokens of the rendered, budget-bounded Substrata context for this query. */
  substrataTokens: number;
  /** Percent fewer tokens vs the baseline (higher is better). */
  reductionPct: number;
  /** ms to read+concat the whole corpus (the naive path). */
  baselineMs: number;
  /** ms to run indexed retrieval + render for this query. */
  substrataMs: number;
};

export type BenchmarkResult = {
  /** Number of footprints + memory docs in the corpus. */
  corpusDocs: number;
  perQuery: BenchQueryResult[];
  /** Corpus token count (constant across queries). */
  baselineTokens: number;
  /** Average rendered-context tokens across queries. */
  substrataTokens: number;
  /** Average token reduction percent across queries. */
  reductionPct: number;
  baselineMs: number;
  /** Average retrieval+render ms across queries. */
  substrataMs: number;
};

export type BenchmarkOptions = {
  /** Queries to benchmark (each is one retrieval). */
  queries: string[];
  /** Token budget for the rendered Substrata context (defaults to 1600). */
  maxTokens?: number;
  /** Result limit per retrieval (defaults to 8). */
  limit?: number;
  /** Toggle graph expansion (defaults to on). */
  graphEnabled?: boolean;
};

const avg = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Run the token/latency benchmark for `queries` against the project at `cwd`.
 * The FTS index must already exist; callers build it first.
 */
export async function runBenchmark(
  cwd: string,
  options: BenchmarkOptions,
): Promise<BenchmarkResult> {
  const maxTokens = options.maxTokens ?? 1600;
  const limit = options.limit ?? 8;
  const graphEnabled = options.graphEnabled ?? true;

  // Baseline: the whole markdown corpus, read+concatenated — the no-index path.
  const tBaseStart = performance.now();
  const [footprints, memory] = await Promise.all([listFootprints(cwd), listMemoryDocuments(cwd)]);
  const corpus = [...footprints.map((f) => f.raw), ...memory.map((m) => m.raw)].join('\n\n');
  const baselineMs = performance.now() - tBaseStart;
  const baselineTokens = estimateTokens(corpus);
  const corpusDocs = footprints.length + memory.length;

  const perQuery: BenchQueryResult[] = [];
  for (const query of options.queries) {
    const tStart = performance.now();
    const hybrid = await hybridSearch(query, {
      cwd,
      limit,
      excludeSuperseded: true,
      graphEnabled,
      graphLimit: limit,
    });
    const rendered = renderGraphContext(query, hybrid, footprints, memory, maxTokens, limit);
    const substrataMs = performance.now() - tStart;
    const substrataTokens = estimateTokens(rendered.text);

    perQuery.push({
      query,
      baselineTokens,
      substrataTokens,
      reductionPct:
        baselineTokens > 0 ? ((baselineTokens - substrataTokens) / baselineTokens) * 100 : 0,
      baselineMs,
      substrataMs,
    });
  }

  const substrataTokens = Math.round(avg(perQuery.map((q) => q.substrataTokens)));
  return {
    corpusDocs,
    perQuery,
    baselineTokens,
    substrataTokens,
    reductionPct:
      baselineTokens > 0 ? ((baselineTokens - substrataTokens) / baselineTokens) * 100 : 0,
    baselineMs,
    substrataMs: avg(perQuery.map((q) => q.substrataMs)),
  };
}
