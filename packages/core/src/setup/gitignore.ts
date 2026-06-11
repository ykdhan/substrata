import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '../types';
import { isSymlink } from './symlink';

/**
 * Ensure `.gitignore` ignores Substrata's generated directories without
 * duplicating lines. Pure + dry-runnable.
 */

export const GITIGNORE_LINES = ['.substrata/index/', '.substrata/cache/', '.substrata/tmp/'];

function readIfExists(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function ensureGitignore(cwd: string, dry: boolean = false): ChangeResult {
  const filePath = path.join(cwd, '.gitignore');
  if (isSymlink(filePath)) {
    return { path: filePath, action: 'skip', description: 'refused: .gitignore is a symlink' };
  }
  const existing = readIfExists(filePath);
  const present = existing ?? '';
  const presentLines = new Set(present.split(/\r?\n/).map((l) => l.trim()));

  const missing = GITIGNORE_LINES.filter((line) => !presentLines.has(line));

  if (missing.length === 0) {
    return {
      path: filePath,
      action: 'skip',
      description: existing === null ? 'no gitignore needed' : 'gitignore already covers Substrata',
    };
  }

  const header = '# Substrata generated files';
  const block = presentLines.has(header) ? missing.join('\n') : `${header}\n${missing.join('\n')}`;

  let next: string;
  if (existing === null) {
    next = `${block}\n`;
  } else {
    const sep = existing.endsWith('\n') ? '' : '\n';
    next = `${existing}${sep}${block}\n`;
  }

  if (!dry) writeFileSync(filePath, next, 'utf8');

  return {
    path: filePath,
    action: existing === null ? 'create' : 'update',
    description: `add ${missing.length} gitignore line(s)`,
    contents: next,
  };
}
