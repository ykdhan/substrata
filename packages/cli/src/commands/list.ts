import { listFootprints, type Footprint } from '@substrata/core';
import type { Command } from 'commander';

import { renderFootprintList } from '../render/table';
import { out, requireConfig, resolveCwd } from '../util';

/**
 * `substrata list` — list footprints filtered by tag/file/since. No index needed;
 * reads footprint files directly (plan §8.6).
 */

type ListOptions = {
  tag?: string;
  file?: string;
  since?: string;
  json?: boolean;
};

function matches(fp: Footprint, opts: ListOptions): boolean {
  if (opts.tag && !(fp.frontmatter.tags ?? []).includes(opts.tag)) return false;
  if (opts.file && !(fp.frontmatter.files_touched ?? []).includes(opts.file)) return false;
  if (opts.since && fp.frontmatter.created_at < opts.since) return false;
  return true;
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List recent footprints')
    .option('--tag <tag>', 'Only footprints carrying this tag')
    .option('--file <path>', 'Only footprints touching this file')
    .option('--since <date>', 'Only footprints created on/after this ISO date')
    .option('--json', 'Output JSON')
    .action(async (opts: ListOptions, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      await requireConfig(cwd);

      const all = await listFootprints(cwd);
      const filtered = all.filter((fp) => matches(fp, opts));

      if (opts.json) {
        const rows = filtered.map((fp) => ({
          id: fp.frontmatter.id,
          title: fp.title,
          status: fp.frontmatter.status,
          createdAt: fp.frontmatter.created_at,
          tags: fp.frontmatter.tags ?? [],
          filesTouched: fp.frontmatter.files_touched ?? [],
          filePath: fp.filePath,
        }));
        out.plain(JSON.stringify(rows, null, 2));
        return;
      }

      out.plain(
        renderFootprintList(
          filtered.map((fp) => ({
            id: fp.frontmatter.id,
            title: fp.title,
            status: fp.frontmatter.status,
            createdAt: fp.frontmatter.created_at,
            tags: fp.frontmatter.tags ?? [],
          })),
        ),
      );
    });
}
