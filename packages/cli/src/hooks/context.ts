import {
  listFootprints,
  listMemoryDocuments,
  type Footprint,
  type SubstrataConfig,
} from '@substrata/core';
import { search } from '@substrata/search';

import { ensureFreshIndex } from '../commands/auto-index';
import { renderContext } from '../render/context';

/**
 * Context builders shared by the lifecycle hooks. Kept separate from the
 * `context` command so the hook path can apply its own token budget / relevance
 * threshold (config.hooks.*) without disturbing the user-facing command.
 */

/** Token budget for hook injection: hooks override, else the search default. */
function hookBudget(config: SubstrataConfig): number {
  return config.hooks.max_context_tokens ?? config.search.max_context_tokens;
}

/**
 * Search-backed context for a query (the user prompt, or branch+files at session
 * start). Returns null when nothing clears the relevance threshold so the hook
 * injects no noise.
 */
export async function buildHookContext(
  cwd: string,
  config: SubstrataConfig,
  opts: { query: string; files?: string[] },
): Promise<string | null> {
  if (!opts.query.trim()) return null;

  await ensureFreshIndex(cwd, true);

  const results = await search(opts.query, {
    cwd,
    limit: config.search.default_limit,
    files: opts.files && opts.files.length > 0 ? opts.files : undefined,
    excludeSuperseded: true,
  });

  const relevant = results.filter((r) => r.score >= config.hooks.min_score);
  if (relevant.length === 0) return null;

  const [footprints, memory] = await Promise.all([
    listFootprints(cwd),
    listMemoryDocuments(cwd),
  ]);

  const rendered = renderContext(relevant, footprints, memory, hookBudget(config));
  if (rendered.sources.length === 0) return null;
  return rendered.text;
}

/** One-line gist of a footprint for the session-start awareness digest. */
function footprintGist(fp: Footprint): string {
  const s = fp.sections;
  const detail = s.decisions?.[0] ?? s.futureAgentGuidance ?? s.purpose;
  const trimmed = detail
    ?.split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return trimmed ? `${fp.title} — ${trimmed}` : fp.title;
}

/**
 * Awareness digest for SessionStart when there is no query to search on: the N
 * most recent (non-superseded) footprints, so a fresh session knows project
 * memory exists and what was last decided. Returns null when there are none.
 */
export async function recentDigest(cwd: string, limit = 3): Promise<string | null> {
  const footprints = (await listFootprints(cwd)).filter(
    (fp) => fp.frontmatter.status !== 'superseded' && fp.frontmatter.status !== 'deprecated',
  );
  if (footprints.length === 0) return null;

  const lines = footprints.slice(0, limit).map((fp, i) => `${i + 1}. ${footprintGist(fp)}`);
  const more = footprints.length > limit ? `\n(+${footprints.length - limit} more — search with substrata_context / \`substrata context\`.)` : '';
  return `Recent Substrata project memory:\n\n${lines.join('\n')}${more}`;
}
