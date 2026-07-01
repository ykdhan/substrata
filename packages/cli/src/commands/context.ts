import { listFootprints, listMemoryDocuments } from '@substrata/core';
import { search } from '@substrata/index';
import type { Command } from 'commander';

import { renderContext } from '../render/context';
import { out, recordAccess, requireConfig, resolveCwd } from '../util';

import { ensureFreshIndex } from './auto-index';

/**
 * `substrata context <task>` — concise, source-linked context for an agent
 * before work begins. Excludes superseded footprints by DEFAULT (agents should
 * see the current decision). Fits a token budget estimated as ceil(chars/3.5).
 * Auto-(re)builds a stale/missing index like `search` (plan §8.4).
 */

type ContextOptions = {
  json?: boolean;
  maxTokens?: string;
  files?: string[];
  autoIndex?: boolean;
};

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function registerContextCommand(program: Command): void {
  program
    .command('context <task>')
    .description('Return concise, source-linked context for an agent')
    .option('--json', 'Output JSON ({ context, sources })')
    .option('--max-tokens <n>', 'Approximate token budget (chars/3.5)')
    .option('--files <path>', 'Bias toward docs touching this file (repeatable)', collect, [])
    .option('--no-auto-index', 'Do not auto-(re)build a stale/missing index')
    .action(async (task: string, opts: ContextOptions, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      const config = await requireConfig(cwd);

      await ensureFreshIndex(cwd, opts.autoIndex !== false);

      const maxTokens = opts.maxTokens ? Number(opts.maxTokens) : config.search.max_context_tokens;
      const budget = Number.isFinite(maxTokens) ? maxTokens : config.search.max_context_tokens;

      const results = await search(task, {
        cwd,
        limit: config.search.default_limit,
        files: opts.files && opts.files.length > 0 ? opts.files : undefined,
        excludeSuperseded: true,
      });

      const [footprints, memory] = await Promise.all([
        listFootprints(cwd),
        listMemoryDocuments(cwd),
      ]);

      const rendered = renderContext(results, footprints, memory, budget);

      recordAccess(cwd, config, {
        op: 'context',
        query: task,
        resultCount: rendered.sources.length,
        returnedIds: rendered.sources.map((s) => s.id),
        source: 'cli',
      });

      if (opts.json) {
        out.plain(JSON.stringify({ context: rendered.text, sources: rendered.sources }, null, 2));
        return;
      }
      out.plain(rendered.text);
    });
}
