import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '@substrata/core';

import { SUBSTRATA_RULES_MARKDOWN } from './agents-md';
import { upsertMarkerSection } from './markers';
import { isSymlink } from './symlink';

/**
 * Per-editor agent-rule generators (graph-rag-implementation.md "Agent Rule
 * 자동 생성"). Substrata is editor-agnostic, so `init` writes the SAME rules
 * (sourced from `SUBSTRATA_RULES_MARKDOWN`) into each editor's native location:
 *
 *   - AGENTS.md             — Codex + the cross-tool standard (see agents-md.ts)
 *   - CLAUDE.md             — Claude Code's native memory file
 *   - GEMINI.md             — Gemini CLI's context file
 *   - .cursor/rules/*.mdc   — Cursor's project rules (alwaysApply)
 *
 * Shared markdown files (CLAUDE.md / GEMINI.md) get a marker-delimited section so
 * user content is preserved; the Cursor rule is a dedicated file we own outright.
 */

const BEGIN = '<!-- substrata:start -->';
const END = '<!-- substrata:end -->';
const SECTION = `${BEGIN}\n${SUBSTRATA_RULES_MARKDOWN}\n${END}`;

/** Upsert the Substrata section into `<cwd>/CLAUDE.md`. */
export function upsertClaudeMd(cwd: string, dry: boolean = false): ChangeResult {
  return upsertMarkerSection(path.join(cwd, 'CLAUDE.md'), {
    begin: BEGIN,
    end: END,
    section: SECTION,
    dry,
    symlinkLabel: 'CLAUDE.md',
    skipDescription: 'CLAUDE.md section already current',
    writeDescription: 'write Substrata CLAUDE.md section',
  });
}

/** Upsert the Substrata section into `<cwd>/GEMINI.md`. */
export function upsertGeminiMd(cwd: string, dry: boolean = false): ChangeResult {
  return upsertMarkerSection(path.join(cwd, 'GEMINI.md'), {
    begin: BEGIN,
    end: END,
    section: SECTION,
    dry,
    symlinkLabel: 'GEMINI.md',
    skipDescription: 'GEMINI.md section already current',
    writeDescription: 'write Substrata GEMINI.md section',
  });
}

/** The dedicated Cursor rule file content (MDC frontmatter + shared rules). */
const CURSOR_RULE = `---
description: Substrata shared agent memory — check context before non-trivial work, leave a footprint after
alwaysApply: true
---

${SUBSTRATA_RULES_MARKDOWN}
`;

/**
 * Write the dedicated Cursor rule at `.cursor/rules/substrata.mdc`. Unlike the
 * shared markdown files this is a Substrata-owned file, so it is written whole
 * (idempotent by exact content match).
 */
export function upsertCursorRule(cwd: string, dry: boolean = false): ChangeResult {
  const filePath = path.join(cwd, '.cursor', 'rules', 'substrata.mdc');
  if (isSymlink(filePath)) {
    return { path: filePath, action: 'skip', description: 'refused: substrata.mdc is a symlink' };
  }
  let existing: string | null;
  try {
    existing = readFileSync(filePath, 'utf8');
  } catch {
    existing = null;
  }
  if (existing === CURSOR_RULE) {
    return { path: filePath, action: 'skip', description: 'Cursor rule already current' };
  }
  if (!dry) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, CURSOR_RULE, 'utf8');
  }
  return {
    path: filePath,
    action: existing === null ? 'create' : 'update',
    description: 'write Substrata Cursor rule',
    contents: CURSOR_RULE,
  };
}

/**
 * Upsert all per-editor rule files (CLAUDE.md, GEMINI.md, Cursor rule). AGENTS.md
 * is handled separately by `upsertAgentsMd`. Returns one ChangeResult per file.
 */
export function upsertEditorRules(cwd: string, dry: boolean = false): ChangeResult[] {
  return [upsertClaudeMd(cwd, dry), upsertGeminiMd(cwd, dry), upsertCursorRule(cwd, dry)];
}
