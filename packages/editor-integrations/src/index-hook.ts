import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '@substrata/core';

import { isSymlink } from './symlink';

/**
 * Auto-rebuild git hooks (post-merge + post-checkout). The index is a
 * deterministic function of the committed markdown "ledger", so rather than
 * committing the binary DB, each clone re-derives the identical index. These
 * hooks make that seamless: after a pull/merge or a branch checkout/clone they
 * re-derive the index in the background, so the first query is instant.
 *
 * The refresh only rebuilds when content actually changed (content-hash
 * freshness), runs detached + silent, and can never block or fail the git
 * operation. Only the guarded block is ever touched (idempotent, symlink-safe).
 */

const REFRESH_INVOCATION = 'npx --no-install substrata-cli internal-refresh-index >/dev/null 2>&1';

type HookSpec = { name: string; guard: string; block: string };

const HOOKS: HookSpec[] = [
  {
    name: 'post-merge',
    guard: 'substrata post-merge',
    block: [
      '# Re-derive the Substrata index from the committed markdown after a pull/merge.',
      'if [ -f .substrata/config.yml ]; then',
      `  ( ${REFRESH_INVOCATION} & )`,
      'fi',
    ].join('\n'),
  },
  {
    name: 'post-checkout',
    // Args: $1 old-ref, $2 new-ref, $3 branch-flag (1 = branch checkout / clone).
    guard: 'substrata post-checkout',
    block: [
      '# Re-derive the Substrata index after a branch checkout/clone (flag == 1 only).',
      'if [ "$3" = "1" ] && [ -f .substrata/config.yml ]; then',
      `  ( ${REFRESH_INVOCATION} & )`,
      'fi',
    ].join('\n'),
  },
];

function readIfExists(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** Install/refresh one guarded auto-rebuild hook. */
function installOne(cwd: string, spec: HookSpec, dry: boolean): ChangeResult {
  const filePath = path.join(cwd, '.git', 'hooks', spec.name);
  const begin = `# >>> ${spec.guard} >>>`;
  const end = `# <<< ${spec.guard} <<<`;
  const guardedBlock = `${begin}\n${spec.block}\n${end}`;

  if (isSymlink(filePath)) {
    return {
      path: filePath,
      action: 'skip',
      description: `refused: ${spec.name} hook is a symlink`,
    };
  }

  const existing = readIfExists(filePath);
  let next: string;
  let action: ChangeResult['action'];

  if (existing === null) {
    next = `#!/bin/sh\n${guardedBlock}\n`;
    action = 'create';
  } else if (existing.includes(begin)) {
    return { path: filePath, action: 'skip', description: `${spec.name} hook already installed` };
  } else {
    const sep = existing.endsWith('\n') ? '' : '\n';
    next = `${existing}${sep}\n${guardedBlock}\n`;
    action = 'update';
  }

  if (!dry) {
    writeFileSync(filePath, next, 'utf8');
    chmodSync(filePath, 0o755);
  }

  return {
    path: filePath,
    action,
    description: `install Substrata ${spec.name} auto-rebuild hook`,
    contents: next,
  };
}

/**
 * Install the auto-rebuild post-merge + post-checkout hooks under
 * `<cwd>/.git/hooks/`. Idempotent + dry-runnable. Returns one ChangeResult per
 * hook.
 */
export function installIndexHook(cwd: string, dry: boolean = false): ChangeResult[] {
  return HOOKS.map((spec) => installOne(cwd, spec, dry));
}

/**
 * True when at least one Substrata auto-rebuild hook is already installed. Lets
 * `upgrade` refresh the hooks only where `init` previously set them up, without
 * duplicating the guard-marker knowledge that lives here.
 */
export function indexHookInstalled(cwd: string): boolean {
  return HOOKS.some((spec) => {
    try {
      const content = readFileSync(path.join(cwd, '.git', 'hooks', spec.name), 'utf8');
      return content.includes(`# >>> ${spec.guard} >>>`);
    } catch {
      return false;
    }
  });
}
