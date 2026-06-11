import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '../types';
import { isSymlink } from './symlink';

/**
 * Insert/replace the Substrata section in AGENTS.md between begin/end markers.
 * Replace-in-place on rerun; never duplicates. Pure + dry-runnable. See plan §10.
 */

const BEGIN = '<!-- substrata:start -->';
const END = '<!-- substrata:end -->';

export const AGENTS_MD_SECTION = `${BEGIN}
## Substrata Rules

This repository uses Substrata for shared agent memory.

Set these once per agent session so footprints are attributed correctly:
- \`SUBSTRATA_ACTOR\`     (e.g. "claude-code")
- \`SUBSTRATA_MODEL\`     (e.g. "claude-opus-4")
- \`SUBSTRATA_REQUESTER\` (falls back to git user.email)

Before making non-trivial changes:

1. Run \`substrata context "<task description>"\`.
2. Search for relevant files using \`substrata search\` or the MCP tool \`substrata_context\`.
3. Respect prior architectural decisions unless the user explicitly asks to override them.

After making non-trivial changes:

1. Add a footprint with \`substrata add\` or MCP tool \`substrata_add\`.
2. Include: purpose, requester, actor, files changed, decisions made, rejected
   alternatives, implementation notes, commands run, memory learned, future agent guidance.
3. If the work changes durable repo conventions, update \`.substrata/memory/\`.
4. If the work reverses a prior decision, use \`substrata supersede\`.

Do not store secrets, credentials, private keys, tokens, or sensitive user data in Substrata files.
${END}`;

function readIfExists(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Upsert the Substrata section into `<cwd>/AGENTS.md`. */
export function upsertAgentsMd(cwd: string, dry: boolean = false): ChangeResult {
  const filePath = path.join(cwd, 'AGENTS.md');
  if (isSymlink(filePath)) {
    return { path: filePath, action: 'skip', description: 'refused: AGENTS.md is a symlink' };
  }
  const existing = readIfExists(filePath);
  const markerRe = new RegExp(`${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}`, 'm');

  let next: string;
  let action: ChangeResult['action'];

  if (existing === null) {
    next = `${AGENTS_MD_SECTION}\n`;
    action = 'create';
  } else if (markerRe.test(existing)) {
    const replaced = existing.replace(markerRe, AGENTS_MD_SECTION);
    if (replaced === existing) {
      return { path: filePath, action: 'skip', description: 'AGENTS.md section already current' };
    }
    next = replaced;
    action = 'update';
  } else {
    const sep = existing.endsWith('\n') ? '' : '\n';
    next = `${existing}${sep}\n${AGENTS_MD_SECTION}\n`;
    action = 'update';
  }

  if (!dry) writeFileSync(filePath, next, 'utf8');

  return {
    path: filePath,
    action,
    description: 'write Substrata AGENTS.md section',
    contents: next,
  };
}
