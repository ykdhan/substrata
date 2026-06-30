// substrata_search tool logic. See plan §9.

import type { SearchResult } from '@substrata/core';
import { buildIndex, getIndexStatus, search } from '@substrata/index';
import { z } from 'zod';

import { recordRead } from './telemetry';

/** Raw zod shape for the substrata_search tool input. */
export const searchInputShape = {
  query: z.string().describe('Free-text query over footprints and curated memory.'),
  limit: z.number().int().positive().optional().describe('Maximum number of results.'),
  files: z
    .array(z.string())
    .optional()
    .describe('Restrict to docs whose files_touched include one of these paths.'),
  tags: z.array(z.string()).optional().describe('Restrict to docs carrying one of these tags.'),
  excludeSuperseded: z
    .boolean()
    .optional()
    .describe('Drop superseded/deprecated footprints entirely.'),
} as const;

export type SearchInput = {
  query: string;
  limit?: number;
  files?: string[];
  tags?: string[];
  excludeSuperseded?: boolean;
};

/**
 * Ensure the on-disk index reflects the current footprint/memory files before
 * querying. The index is gitignored and therefore absent right after clone, so
 * we (re)build on missing/stale.
 */
export async function ensureIndexFresh(cwd: string): Promise<void> {
  const status = await getIndexStatus(cwd);
  if (status.state !== 'fresh') {
    await buildIndex(cwd);
  }
}

export async function runSearch(
  input: SearchInput,
  cwd: string,
): Promise<{ results: SearchResult[] }> {
  await ensureIndexFresh(cwd);
  const results = await search(input.query, {
    cwd,
    limit: input.limit,
    files: input.files,
    tags: input.tags,
    excludeSuperseded: input.excludeSuperseded,
  });
  await recordRead(cwd, {
    op: 'search',
    query: input.query,
    resultCount: results.length,
    returnedIds: results.map((r) => r.id),
    source: 'mcp',
  });
  return { results };
}
