import { readFileSync, writeFileSync } from 'node:fs';

import type { AttributionEnv, ChangeResult } from '../types';

/**
 * Write a Substrata env block to a shell rc file, delimited by markers so a
 * re-run replaces it in place rather than appending. Pure + dry-runnable.
 */

const BEGIN = '# >>> substrata >>>';
const END = '# <<< substrata <<<';

function readIfExists(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function renderBlock(vars: AttributionEnv): string {
  const lines: string[] = [BEGIN, '# Substrata agent attribution (managed; safe to edit values)'];
  if (vars.actor) lines.push(`export SUBSTRATA_ACTOR="${vars.actor}"`);
  if (vars.model) lines.push(`export SUBSTRATA_MODEL="${vars.model}"`);
  if (vars.requester) lines.push(`export SUBSTRATA_REQUESTER="${vars.requester}"`);
  lines.push(END);
  return lines.join('\n');
}

/**
 * Insert or replace the Substrata env block in `rcPath`.
 * The block is delimited by stable markers; reruns replace in place.
 */
export function writeShellEnv(
  rcPath: string,
  vars: AttributionEnv,
  dry: boolean = false,
): ChangeResult {
  const block = renderBlock(vars);
  const existing = readIfExists(rcPath);

  const markerRe = new RegExp(`${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}`, 'm');

  let next: string;
  let action: ChangeResult['action'];

  if (existing === null) {
    next = `${block}\n`;
    action = 'create';
  } else if (markerRe.test(existing)) {
    const replaced = existing.replace(markerRe, block);
    if (replaced === existing) {
      return { path: rcPath, action: 'skip', description: 'env block already current' };
    }
    next = replaced;
    action = 'update';
  } else {
    const sep = existing.endsWith('\n') ? '' : '\n';
    next = `${existing}${sep}\n${block}\n`;
    action = 'update';
  }

  if (!dry) writeFileSync(rcPath, next, 'utf8');

  return {
    path: rcPath,
    action,
    description: 'write Substrata env block',
    contents: next,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
