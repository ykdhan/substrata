import { buildGraph, buildIndex } from '@substrata/search';
import type { Command } from 'commander';

import { out, requireConfig, resolveCwd } from '../util';

/**
 * `substrata index` / `index --rebuild` — build or rebuild the local indexes.
 * Always rebuilds the FTS index; also rebuilds the auxiliary graph index when
 * `graph.enabled` (graph-rag-implementation.md §4: "FTS Index Build + Graph
 * Index Build"). The MVP indexer always does a full rebuild, so `--rebuild` is
 * accepted for symmetry with the documented flag.
 */
export function registerIndexCommand(program: Command): void {
  program
    .command('index')
    .description('Build or rebuild the local search index (FTS + graph)')
    .option('--rebuild', 'Force a full rebuild of the index')
    .option('--no-graph', 'Skip building the auxiliary graph index')
    .action(async (opts: { rebuild?: boolean; graph?: boolean }, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      const config = await requireConfig(cwd);
      await buildIndex(cwd, { rebuild: true });

      if (config.graph.enabled && opts.graph !== false) {
        await buildGraph(cwd);
        out.ok('Index built (FTS + graph).');
        return;
      }
      out.ok('Index built.');
    });
}
