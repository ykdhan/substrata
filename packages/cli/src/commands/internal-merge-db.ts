import { copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { graphPath, indexPath, loadConfig } from '@substrata/core';
import { buildGraph, buildIndex } from '@substrata/index';
import type { Command } from 'commander';

import { resolveCwd } from '../util';

/**
 * Hidden command invoked by the `substrata-rebuild` git merge driver (see
 * merge-driver.ts). Git calls it as `internal-merge-db <%A> <%P>` for a
 * conflicting `.substrata/index/*.sqlite`:
 *   - %A = the "ours"/result temp file the driver must leave the merged content in
 *   - %P = the conflicting file's repo-relative path
 *
 * The DB is derived, so the merge result is just a rebuild from the (already
 * text-merged) markdown: rebuild the index/graph, then copy the freshly built file
 * for %P into %A. On any failure we exit non-zero so git leaves the conflict for
 * manual resolution rather than committing a bad DB.
 */
export function registerInternalMergeDbCommand(program: Command): void {
  program
    .command('internal-merge-db', { hidden: true })
    .argument('<ours>', 'Path git expects the merged result in (%A)')
    .argument('<repoPath>', 'Repo-relative path of the conflicting file (%P)')
    .action(async (ours: string, repoPath: string, _opts: unknown, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      try {
        // The conflicted DB files may be corrupt (a half-merged binary), and
        // opening a non-database file throws. Remove them so the rebuild starts
        // from a clean slate — the markdown is the source of truth anyway.
        for (const p of [indexPath(cwd), graphPath(cwd)]) {
          try {
            rmSync(p);
          } catch {
            // not present — fine, buildIndex/buildGraph will create it.
          }
        }
        await buildIndex(cwd, { rebuild: true });
        try {
          if ((await loadConfig(cwd)).graph.enabled) await buildGraph(cwd);
        } catch {
          // graph is auxiliary + fail-open; a graph build failure must not block
          // resolving an FTS-index conflict.
        }
        copyFileSync(path.join(cwd, repoPath), ours);
        process.exitCode = 0;
      } catch {
        // Could not rebuild (e.g. markdown still has conflict markers) — signal an
        // unresolved conflict so git does not auto-commit a broken DB.
        process.exitCode = 1;
      }
    });
}
