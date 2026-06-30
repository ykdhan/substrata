import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '@substrata/core';
import { isSymlink } from './symlink';

/**
 * In `shared` storage mode the index/graph SQLite DB is committed so a team
 * shares one prebuilt index. Mark those files as binary in `.gitattributes` so
 * Git never tries to line-diff or merge them. The markdown footprints/memory
 * remain the source of truth, so the documented conflict resolution is simply to
 * rebuild: `substrata index` (FTS) + `substrata graph build`.
 *
 * Idempotent + dry-runnable; only the guarded block is ever touched.
 */

const GUARD_BEGIN = '# >>> substrata >>>';
const GUARD_END = '# <<< substrata <<<';

const MANAGED_BLOCK = `${GUARD_BEGIN}
# Shared Substrata index DBs are binary; on conflict, rebuild from the committed
# markdown (source of truth): \`substrata index\` + \`substrata graph build\`.
.substrata/index/*.sqlite binary
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
