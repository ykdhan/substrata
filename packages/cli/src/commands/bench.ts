import { listFootprints } from '@substrata/core';
import { runBenchmark, type BenchmarkResult } from '@substrata/index';
import type { Command } from 'commander';

import { out, requireConfig, resolveCwd } from '../util';

import { ensureFreshIndex } from './auto-index';

/**
 * `substrata bench` — quantify what the index buys over the naive no-index path
 * (an agent reading every footprint + memory file to find context).
 *
 * Reports, per query and in aggregate: tokens read by the baseline (whole
 * corpus) vs Substrata (budget-bounded retrieval), the token reduction %, and
 * the wall-clock latency of each path. All local; nothing is transmitted.
 */

type BenchOptions = {
  json?: boolean;
  limit?: string;
  maxTokens?: string;
  graph?: boolean;
};

/** Default queries when the user supplies none: the most recent footprint titles. */
async function defaultQueries(cwd: string): Promise<string[]> {
  const footprints = await listFootprints(cwd);
  const queries = footprints
    .filter(
      (fp) => fp.frontmatter.status !== 'superseded' && fp.frontmatter.status !== 'deprecated',
    )
    .slice(0, 5)
    .map((fp) => fp.title);
  return queries.length > 0 ? queries : ['project memory'];
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function printTable(result: BenchmarkResult): void {
  out.plain(`Substrata benchmark — ${result.corpusDocs} doc(s) in the corpus`);
  out.plain('');
  out.plain('  Baseline = read the whole .substrata markdown corpus (no index).');
  out.plain('  Substrata = FTS + graph retrieval rendered within the token budget.');
  out.plain('');
  out.plain(
    `  ${'query'.padEnd(34)} ${'baseline'.padStart(9)} ${'substrata'.padStart(10)} ${'saved'.padStart(7)} ${'b.ms'.padStart(7)} ${'s.ms'.padStart(7)}`,
  );
  for (const q of result.perQuery) {
    const label = q.query.length > 33 ? `${q.query.slice(0, 32)}…` : q.query;
    out.plain(
      `  ${label.padEnd(34)} ${String(q.baselineTokens).padStart(9)} ${String(q.substrataTokens).padStart(10)} ${`${q.reductionPct.toFixed(0)}%`.padStart(7)} ${q.baselineMs.toFixed(1).padStart(7)} ${q.substrataMs.toFixed(1).padStart(7)}`,
    );
  }
  out.plain('');
  out.plain(
    `  average: ${result.baselineTokens} → ${result.substrataTokens} tokens ` +
      `(${result.reductionPct.toFixed(0)}% fewer), ` +
      `${result.baselineMs.toFixed(1)}ms → ${result.substrataMs.toFixed(1)}ms.`,
  );
}

export function registerBenchCommand(program: Command): void {
  program
    .command('bench')
    .description('Benchmark token + latency cost: whole-corpus read vs Substrata indexed retrieval')
    .argument('[queries...]', 'Queries to benchmark (defaults to recent footprint titles)')
    .option('--max-tokens <n>', 'Token budget for the rendered context (default 1600)')
    .option('--limit <n>', 'Results per retrieval (default 8)')
    .option('--no-graph', 'Disable graph expansion during retrieval')
    .option('--json', 'Output JSON')
    .action(async (queries: string[], opts: BenchOptions, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      const config = await requireConfig(cwd);

      // Ensure the index is present/fresh before timing it, but DON'T force a
      // rebuild: in shared mode an unconditional rebuild would dirty the committed
      // DB in the working tree. ensureFreshIndex builds only when missing/stale;
      // the graph is auto-(re)built by hybridSearch's fail-open path as needed.
      await ensureFreshIndex(cwd, true);

      const resolvedQueries = queries.length > 0 ? queries : await defaultQueries(cwd);
      const result = await runBenchmark(cwd, {
        queries: resolvedQueries,
        maxTokens: parsePositiveInt(opts.maxTokens, config.search.max_context_tokens),
        limit: parsePositiveInt(opts.limit, config.search.default_limit),
        graphEnabled: config.graph.enabled && opts.graph !== false,
      });

      if (opts.json) {
        out.plain(JSON.stringify(result, null, 2));
        return;
      }
      printTable(result);
    });
}
