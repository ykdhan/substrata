import { loadConfig } from '@substrata/core';
import { ensureGraphFresh } from '@substrata/index';
import type { Command } from 'commander';

import { resolveCwd } from '../util';

import { ensureFreshIndex } from './auto-index';

/**
 * Hidden command invoked by the auto-rebuild git hooks (post-merge / post-checkout,
 * see editor-integrations/index-hook.ts). It re-derives the local index from the
 * committed markdown "ledger" so a pull/checkout leaves the index ready — the graph
 * is a deterministic function of the markdown, so every teammate rebuilds the
 * identical index without the DB ever being shared.
 *
 * Cheap by design: it only rebuilds when content actually changed (content-hash
 * freshness), so an unchanged pull is a no-op. Fail-safe: any error is swallowed
 * and it exits 0 — a git hook must never break the git operation.
 */
export function registerInternalRefreshIndexCommand(program: Command): void {
  program
    .command('internal-refresh-index', { hidden: true })
    .description('Rebuild the local index from the committed markdown when stale (git-hook use)')
    .action(async (_opts: unknown, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      try {
        await ensureFreshIndex(cwd, true);
        let graphEnabled = true;
        try {
          graphEnabled = (await loadConfig(cwd)).graph.enabled;
        } catch {
          // No/invalid config: nothing to refresh.
          graphEnabled = false;
        }
        if (graphEnabled) await ensureGraphFresh(cwd);
      } catch {
        // best-effort: never fail the git operation that triggered this.
      }
      process.exitCode = 0;
    });
}
