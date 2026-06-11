import { buildIndex } from '@substrata/search';
import type { Command } from 'commander';

import { out, requireConfig, resolveCwd } from '../util';

/**
 * `substrata index` / `index --rebuild` — build or rebuild the local FTS index.
 * The MVP indexer always does a full rebuild, so `--rebuild` is accepted for
 * symmetry with the documented flag.
 */
export function registerIndexCommand(program: Command): void {
  program
    .command('index')
    .description('Build or rebuild the local search index')
    .option('--rebuild', 'Force a full rebuild of the index')
    .action(async (_opts: { rebuild?: boolean }, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      await requireConfig(cwd);
      await buildIndex(cwd, { rebuild: true });
      out.ok('Index built.');
    });
}
