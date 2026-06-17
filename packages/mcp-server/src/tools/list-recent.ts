// substrata_list_recent tool logic. See plan §9.

import { listFootprints, type Footprint, type SearchResult } from '@substrata/core';
import { z } from 'zod';

import { recordRead } from './telemetry';

const DEFAULT_LIMIT = 8;

/** Raw zod shape for the substrata_list_recent tool input. */
export const listRecentInputShape = {
  limit: z.number().int().positive().optional().describe('Maximum number of footprints.'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Restrict to footprints carrying one of these tags.'),
} as const;

export type ListRecentInput = {
  limit?: number;
  tags?: string[];
};

/** Sort key: prefer updated_at, fall back to created_at. */
function recencyKey(fp: Footprint): string {
  return fp.frontmatter.updated_at ?? fp.frontmatter.created_at ?? '';
}

/** Map a parsed footprint to a SearchResult-shaped summary (no FTS score). */
function toSummary(fp: Footprint): SearchResult {
  const snippet = fp.sections.purpose?.trim() ?? '';
  return {
    id: fp.frontmatter.id,
    title: fp.title,
    filePath: fp.filePath,
    score: 0,
    snippet,
    tags: fp.frontmatter.tags ?? [],
    createdAt: fp.frontmatter.created_at,
    filesTouched: fp.frontmatter.files_touched ?? [],
    status: fp.frontmatter.status,
  };
}

export async function runListRecent(
  input: ListRecentInput,
  cwd: string,
): Promise<{ results: SearchResult[] }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  let footprints = await listFootprints(cwd);

  if (input.tags && input.tags.length > 0) {
    const wanted = new Set(input.tags);
    footprints = footprints.filter((fp) => (fp.frontmatter.tags ?? []).some((t) => wanted.has(t)));
  }

  footprints.sort((a, b) => recencyKey(b).localeCompare(recencyKey(a)));
  const results = footprints.slice(0, limit).map(toSummary);
  await recordRead(cwd, {
    op: 'list',
    resultCount: results.length,
    returnedIds: results.map((r) => r.id),
    source: 'mcp',
  });
  return { results };
}
