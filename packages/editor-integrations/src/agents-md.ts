import path from 'node:path';

import type { ChangeResult } from '@substrata/core';

import { upsertMarkerSection } from './markers';

/**
 * Insert/replace the Substrata section in AGENTS.md between begin/end markers.
 * Replace-in-place on rerun; never duplicates. Pure + dry-runnable. See plan §10.
 *
 * `SUBSTRATA_RULES_MARKDOWN` (the marker-free body) is the single source of truth
 * for the agent rules — `editor-rules.ts` reuses it for CLAUDE.md / GEMINI.md /
 * the Cursor rule so every editor gets identical guidance.
 */

const BEGIN = '<!-- substrata:start -->';
const END = '<!-- substrata:end -->';

export const SUBSTRATA_RULES_MARKDOWN = `## Substrata Rules

This repository uses Substrata for shared agent memory.

If the Claude Code lifecycle hooks are installed (\`npx -y substrata-cli hook claude\`),
relevant footprints are injected into context automatically on session start and on
each prompt, and a reminder to record one fires after non-trivial work — the steps
below still apply, the hooks just make them reliable rather than optional.

Prefer the MCP tools (\`substrata_context\`, \`substrata_search\`, \`substrata_add\`,
\`substrata_related_to_file\`, \`substrata_list_recent\`) when they are available.
For shell usage, run the CLI as \`npx -y substrata-cli <command>\` — the bare
\`substrata\` binary only exists if the package was installed globally.

For relationship-aware memory, prefer the graph tools (\`substrata_graph_context\`,
\`substrata_graph_related\`, \`substrata_graph_explain\`, \`substrata_graph_stats\`, or
\`npx -y substrata-cli graph context|related|explain|stats\`). \`graph_context\`
returns the same memory as \`substrata_context\` plus related decisions, rejected
alternatives, related files/concepts, and a "why selected" reason for each item.

Set these once per agent session so footprints are attributed correctly:
- \`SUBSTRATA_ACTOR\`     (e.g. "claude-code")
- \`SUBSTRATA_MODEL\`     (e.g. "claude-opus-4")
- \`SUBSTRATA_REQUESTER\` (falls back to git user.email)

Before making non-trivial changes:

1. Get context with the MCP tool \`substrata_context\` or
   \`npx -y substrata-cli context "<task description>"\`.
2. Search related decisions with \`substrata_search\` or \`npx -y substrata-cli search\`.
3. Respect prior architectural decisions unless the user explicitly asks to override them.

After making non-trivial changes:

1. Add a footprint with the MCP tool \`substrata_add\` or \`npx -y substrata-cli add\`.
2. Include: purpose, requester, actor, files changed, decisions made, rejected
   alternatives, implementation notes, commands run, memory learned, future agent guidance.
3. If the work changes durable repo conventions, update \`.substrata/memory/\`.
4. If the work reverses a prior decision, use \`npx -y substrata-cli supersede\`.

Do not store secrets, credentials, private keys, tokens, or sensitive user data in Substrata files.`;

/** The full AGENTS.md section, including the begin/end markers. */
export const AGENTS_MD_SECTION = `${BEGIN}\n${SUBSTRATA_RULES_MARKDOWN}\n${END}`;

/** Upsert the Substrata section into `<cwd>/AGENTS.md`. */
export function upsertAgentsMd(cwd: string, dry: boolean = false): ChangeResult {
  return upsertMarkerSection(path.join(cwd, 'AGENTS.md'), {
    begin: BEGIN,
    end: END,
    section: AGENTS_MD_SECTION,
    dry,
    symlinkLabel: 'AGENTS.md',
    skipDescription: 'AGENTS.md section already current',
    writeDescription: 'write Substrata AGENTS.md section',
  });
}
