// substrata_context tool logic. See plan §8.4 + §9.

import { loadConfig, type SearchResult } from '@substrata/core';
import { search } from '@substrata/search';
import { z } from 'zod';

import { ensureIndexFresh } from './search';

/** Raw zod shape for the substrata_context tool input. */
export const contextInputShape = {
  task: z.string().describe('What the agent is about to do; used to retrieve relevant memory.'),
  files: z
    .array(z.string())
    .optional()
    .describe('Files the task will touch; boosts docs that reference them.'),
  maxTokens: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Approximate token budget (chars/3.5). Defaults to config search.max_context_tokens.',
    ),
} as const;

export type ContextInput = {
  task: string;
  files?: string[];
  maxTokens?: number;
};

export type ContextSource = { id: string; title: string; filePath: string };

/** Documented char-based token approximation (rounds up to under-fill). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Assemble a concise, numbered, source-linked context block from ranked
 * results, stopping before the token budget is exceeded. Mirrors the CLI
 * renderer's rules (plan §8.4); the ~30 line duplication is intentional to
 * avoid a cross-package dependency on the CLI.
 */
export function assembleContext(
  results: SearchResult[],
  maxTokens: number,
): { context: string; sources: ContextSource[] } {
  const header = 'Relevant Substrata context (token counts are approximate):';
  const blocks: string[] = [];
  const sources: ContextSource[] = [];
  let used = estimateTokens(header);

  let n = 0;
  for (const r of results) {
    n += 1;
    const snippet = r.snippet?.trim() ? r.snippet.trim() : r.title;
    const block = `${n}. ${snippet}\n   Source: ${r.filePath}`;
    const cost = estimateTokens(block) + 2; // +2 for the separating blank line
    if (used + cost > maxTokens && blocks.length > 0) {
      n -= 1;
      break;
    }
    blocks.push(block);
    sources.push({ id: r.id, title: r.title, filePath: r.filePath });
    used += cost;
  }

  if (blocks.length === 0) {
    return { context: 'No relevant Substrata context found.', sources: [] };
  }
  return { context: `${header}\n\n${blocks.join('\n\n')}`, sources };
}

export async function runContext(
  input: ContextInput,
  cwd: string,
): Promise<{ context: string; sources: ContextSource[] }> {
  await ensureIndexFresh(cwd);
  const config = await loadConfig(cwd);
  const maxTokens = input.maxTokens ?? config.search.max_context_tokens;

  // context excludes superseded by default — agents should see the current
  // decision, not the replaced one (plan §8.4).
  const results = await search(input.task, {
    cwd,
    files: input.files,
    excludeSuperseded: true,
    limit: config.search.default_limit,
  });

  return assembleContext(results, maxTokens);
}
