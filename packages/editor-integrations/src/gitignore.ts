import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '@substrata/core';
import { isSymlink } from './symlink';

/**
 * Ensure `.gitignore` ignores the right Substrata generated paths for the chosen
 * storage sharing mode. Pure + dry-runnable.
 *
 *   - 'local'  : ignore the whole generated index dir — the DB is private and
 *                rebuilt per developer (default; prior behavior).
 *   - 'shared' : the index/graph DB IS committed (team-shared), so only ignore
 *                its transient journal sidecars; the `.sqlite` files are kept.
 *
 * `.substrata/local/` (telemetry access log) and `.substrata/cache|tmp/` are
 * ALWAYS ignored, in both modes — private/regenerable data is never committed.
 *
 * The managed lines live inside a guarded marker block so switching modes (e.g.
 * `local` -> `shared`) rewrites them wholesale, never leaving a stale blanket
 * `.substrata/index/` ignore that would hide a now-committed DB.
 */

export type StorageSharing = 'local' | 'shared';

const GUARD_BEGIN = '# >>> substrata generated files >>>';
const GUARD_END = '# <<< substrata generated files <<<';

/** Always-ignored: regenerable cache/tmp + the always-local telemetry log. */
const ALWAYS_IGNORED = ['.substrata/cache/', '.substrata/tmp/', '.substrata/local/'];

/** The gitignore lines for a given sharing mode. */
export function gitignoreLinesFor(sharing: StorageSharing): string[] {
  if (sharing === 'shared') {
    return [
      ...ALWAYS_IGNORED,
      // The DB itself is committed; only its transient journal sidecars are not.
      '.substrata/index/*.sqlite-journal',
      '.substrata/index/*.sqlite-wal',
      '.substrata/index/*.sqlite-shm',
    ];
  }
  return ['.substrata/index/', ...ALWAYS_IGNORED];
}

/**
 * Backward-compatible local-mode line set. Retained for callers (e.g. `doctor`)
 * that reference it directly; new code should prefer `gitignoreLinesFor`.
 */
export const GITIGNORE_LINES = gitignoreLinesFor('local');

function readIfExists(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** Drop any existing guarded Substrata block from `lines` (in place copy). */
function stripManagedBlock(lines: string[]): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === GUARD_BEGIN) {
      inBlock = true;
      continue;
    }
    if (trimmed === GUARD_END) {
      inBlock = false;
      continue;
    }
    if (!inBlock) out.push(line);
  }
  return out;
}

export function ensureGitignore(
  cwd: string,
  dry: boolean = false,
  opts: { sharing?: StorageSharing } = {},
): ChangeResult {
  const sharing = opts.sharing ?? 'local';
  const filePath = path.join(cwd, '.gitignore');
  if (isSymlink(filePath)) {
    return { path: filePath, action: 'skip', description: 'refused: .gitignore is a symlink' };
  }

  const existing = readIfExists(filePath);
  const managedBlock = [GUARD_BEGIN, ...gitignoreLinesFor(sharing), GUARD_END].join('\n');

  let next: string;
  if (existing === null) {
    next = `${managedBlock}\n`;
  } else {
    // Remove any prior managed block AND any legacy unmarked Substrata lines, so
    // a mode switch can't leave a stale `.substrata/index/` blanket ignore.
    const legacy = new Set([
      '# Substrata generated files',
      ...gitignoreLinesFor('local'),
      ...gitignoreLinesFor('shared'),
    ]);
    const kept = stripManagedBlock(existing.split('\n')).filter((l) => !legacy.has(l.trim()));
    // Collapse a trailing run of blank lines left by the removals.
    while (kept.length > 0 && kept[kept.length - 1]!.trim() === '') kept.pop();
    const body = kept.join('\n');
    next = body.length > 0 ? `${body}\n${managedBlock}\n` : `${managedBlock}\n`;
  }

  if (existing !== null && next === existing) {
    return { path: filePath, action: 'skip', description: 'gitignore already up to date' };
  }

  if (!dry) writeFileSync(filePath, next, 'utf8');

  return {
    path: filePath,
    action: existing === null ? 'create' : 'update',
    description: `update Substrata gitignore (${sharing} mode)`,
    contents: next,
  };
}
