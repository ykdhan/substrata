import { search } from '@substrata/index';
import type { Command } from 'commander';

import { renderSearchResults } from '../render/table';
import { out, recordAccess, requireConfig, resolveCwd } from '../util';

import { ensureFreshIndex } from './auto-index';

/**
 * `substrata search <query>` — full-text search over footprints + memory.
 * Auto-(re)builds a stale/missing index unless `--no-auto-index`. By default
 * includes superseded footprints (demoted in ranking) so humans can trace
 * history; `--exclude-superseded` drops them (plan §8.3).
 */

type SearchOptions = {
  json?: boolean;
  files?: string[];
  tag?: string[];
  limit?: string;
  excludeSuperseded?: boolean;
  autoIndex?: boolean;
};

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('Search footprints and memory')
    .option('--json', 'Output JSON')
    .option('--files <path>', 'Filter to docs touching this file (repeatable)', collect, [])
    .option('--tag <tag>', 'Filter to docs carrying this tag (repeatable)', collect, [])
    .option('--limit <n>', 'Maximum number of results')
    .option('--exclude-superseded', 'Drop superseded/deprecated footprints')
    .option('--no-auto-index', 'Do not auto-(re)build a stale/missing index')
    .action(async (query: string, opts: SearchOptions, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      const config = await requireConfig(cwd);

      await ensureFreshIndex(cwd, opts.autoIndex !== false);

      const limit = opts.limit ? Number(opts.limit) : config.search.default_limit;
      const results = await search(query, {
        cwd,
        limit: Number.isFinite(limit) ? limit : config.search.default_limit,
        files: opts.files && opts.files.length > 0 ? opts.files : undefined,
        tags: opts.tag && opts.tag.length > 0 ? opts.tag : undefined,
        excludeSuperseded: opts.excludeSuperseded,
      });

      recordAccess(cwd, config, {
        op: 'search',
        query,
        resultCount: results.length,
        returnedIds: results.map((r) => r.id),
        source: 'cli',
      });

      if (opts.json) {
        out.plain(JSON.stringify(results, null, 2));
        return;
      }
      out.plain(renderSearchResults(results));
    });
}
