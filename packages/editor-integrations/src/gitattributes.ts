import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '@substrata/core';
import { isSymlink } from './symlink';

/**
 * In `shared` storage mode the index/graph SQLite DB is committed so a team
 * shares one prebuilt index. Mark those files as `binary` (never line-diff) and
 * route them through the `substrata-rebuild` merge driver so a conflict is
 * resolved AUTOMATICALLY by rebuilding from the committed markdown (the source of
 * truth) instead of forcing a manual fix. The driver is registered in the repo's
 * git config by `substrata init`/`upgrade` (see configureMergeDriver).
 *
 * Idempotent + dry-runnable; only the guarded block is ever touched.
 */

const GUARD_BEGIN = '# >>> substrata >>>';
const GUARD_END = '# <<< substrata <<<';

const MANAGED_BLOCK = `${GUARD_BEGIN}
# Shared Substrata index DBs are binary + derived from the committed markdown.
# The substrata-rebuild merge driver auto-resolves conflicts by rebuilding;
# if it is not registered, resolve manually: \`substrata index\` (FTS + graph).
.substrata/index/*.sqlite merge=substrata-rebuild binary
${GUARD_END}`;

function readIfExists(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** Ensure `<cwd>/.gitattributes` marks the shared index DBs as binary. */
export function ensureGitattributes(cwd: string, dry: boolean = false): ChangeResult {
  const filePath = path.join(cwd, '.gitattributes');
  if (isSymlink(filePath)) {
    return { path: filePath, action: 'skip', description: 'refused: .gitattributes is a symlink' };
  }

  const existing = readIfExists(filePath);

  let next: string;
  let action: ChangeResult['action'];
  if (existing === null) {
    next = `${MANAGED_BLOCK}\n`;
    action = 'create';
  } else if (existing.includes(GUARD_BEGIN)) {
    return { path: filePath, action: 'skip', description: '.gitattributes already configured' };
  } else {
    const sep = existing.endsWith('\n') ? '' : '\n';
    next = `${existing}${sep}${MANAGED_BLOCK}\n`;
    action = 'update';
  }

  if (!dry) writeFileSync(filePath, next, 'utf8');

  return {
    path: filePath,
    action,
    description: 'mark shared Substrata index DBs as binary',
    contents: next,
  };
}
