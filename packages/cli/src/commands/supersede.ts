import { NotFoundError, supersedeFootprint } from '@substrata/core';
import { buildIndex } from '@substrata/search';
import type { Command } from 'commander';

import { CliError, out, requireConfig, resolveCwd } from '../util';

/**
 * `substrata supersede <old-id> --by <new-id>` — mark an old footprint replaced
 * by a new one (frontmatter-only edits), then rebuild the index so ranking
 * reflects the new status (plan §8.9).
 */
export function registerSupersedeCommand(program: Command): void {
  program
    .command('supersede <old-id>')
    .description('Mark an old footprint as superseded by a new one')
    .requiredOption('--by <new-id>', 'Id of the footprint that replaces the old one')
    .action(async (oldId: string, opts: { by: string }, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      await requireConfig(cwd);

      try {
        await supersedeFootprint(cwd, oldId, opts.by);
      } catch (err) {
        if (err instanceof NotFoundError) throw new CliError(err.message);
        throw err;
      }

      await buildIndex(cwd);
      out.ok(`${oldId} superseded by ${opts.by}. Index rebuilt.`);
    });
}
