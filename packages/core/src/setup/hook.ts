import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '../types';
import { isSymlink } from './symlink';

/**
 * Install a pre-commit hook that runs the Substrata staged-file secret scan as a
 * second line of defense. If a hook already exists, append a guarded block
 * rather than clobbering it. Pure-ish + dry-runnable. See plan §8.11/§12.
 */

const GUARD_BEGIN = '# >>> substrata pre-commit >>>';
const GUARD_END = '# <<< substrata pre-commit <<<';

const GUARDED_BLOCK = `${GUARD_BEGIN}
# Substrata secret scan over staged .substrata files (second line of defense).
npx --no-install substrata internal-scan-staged || exit 1
${GUARD_END}`;

const FULL_HOOK = `#!/bin/sh
${GUARDED_BLOCK}
`;

function readIfExists(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** Install/refresh the pre-commit hook at `<cwd>/.git/hooks/pre-commit`. */
export function installSecretHook(cwd: string, dry: boolean = false): ChangeResult {
  const filePath = path.join(cwd, '.git', 'hooks', 'pre-commit');
  if (isSymlink(filePath)) {
    return { path: filePath, action: 'skip', description: 'refused: pre-commit hook is a symlink' };
  }
  const existing = readIfExists(filePath);

  let next: string;
  let action: ChangeResult['action'];

  if (existing === null) {
    next = FULL_HOOK;
    action = 'create';
  } else if (existing.includes(GUARD_BEGIN)) {
    return { path: filePath, action: 'skip', description: 'pre-commit hook already installed' };
  } else {
    const sep = existing.endsWith('\n') ? '' : '\n';
    next = `${existing}${sep}\n${GUARDED_BLOCK}\n`;
    action = 'update';
  }

  if (!dry) {
    writeFileSync(filePath, next, 'utf8');
    chmodSync(filePath, 0o755);
  }

  return {
    path: filePath,
    action,
    description: 'install Substrata pre-commit secret hook',
    contents: next,
  };
}
