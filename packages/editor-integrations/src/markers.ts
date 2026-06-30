import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '@substrata/core';

import { isSymlink } from './symlink';

/**
 * Generic marker-delimited section upsert, shared by every agent-rule writer
 * (AGENTS.md, CLAUDE.md, GEMINI.md). A re-run replaces the section in place
 * between its begin/end markers rather than appending, so the writers stay
 * idempotent and never duplicate. Refuses to write through a symlink. Pure +
 * dry-runnable.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readIfExists(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export type UpsertMarkerOptions = {
  begin: string;
  end: string;
  /** The full section text, including the begin/end markers. */
  section: string;
  dry?: boolean;
  /** Label used in the symlink-refusal message (defaults to the basename). */
  symlinkLabel?: string;
  /** Description returned when the section is already current. */
  skipDescription?: string;
  /** Description returned when the section is created/updated. */
  writeDescription?: string;
};

export function upsertMarkerSection(filePath: string, opts: UpsertMarkerOptions): ChangeResult {
  const { begin, end, section, dry = false } = opts;
  const label = opts.symlinkLabel ?? path.basename(filePath);

  if (isSymlink(filePath)) {
    return { path: filePath, action: 'skip', description: `refused: ${label} is a symlink` };
  }

  const existing = readIfExists(filePath);
  const markerRe = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');

  let next: string;
  let action: ChangeResult['action'];

  if (existing === null) {
    next = `${section}\n`;
    action = 'create';
  } else if (markerRe.test(existing)) {
    const replaced = existing.replace(markerRe, section);
    if (replaced === existing) {
      return {
        path: filePath,
        action: 'skip',
        description: opts.skipDescription ?? 'section already current',
      };
    }
    next = replaced;
    action = 'update';
  } else {
    const sep = existing.endsWith('\n') ? '' : '\n';
    next = `${existing}${sep}\n${section}\n`;
    action = 'update';
  }

  if (!dry) writeFileSync(filePath, next, 'utf8');

  return {
    path: filePath,
    action,
    description: opts.writeDescription ?? 'write Substrata section',
    contents: next,
  };
}
