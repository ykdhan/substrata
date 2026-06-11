// substrata_related_to_file tool logic. See plan §9.

import type { SearchResult } from '@substrata/core';
import { getRelatedToFile } from '@substrata/search';
import { z } from 'zod';

import { ensureIndexFresh } from './search';

/** Raw zod shape for the substrata_related_to_file tool input. */
export const relatedToFileInputShape = {
  filePath: z.string().describe('Path to find related footprints/memory for.'),
  limit: z.number().int().positive().optional().describe('Maximum number of results.'),
} as const;

export type RelatedToFileInput = {
  filePath: string;
  limit?: number;
};

export async function runRelatedToFile(
  input: RelatedToFileInput,
  cwd: string,
): Promise<{ results: SearchResult[] }> {
  await ensureIndexFresh(cwd);
  const results = await getRelatedToFile(input.filePath, { cwd, limit: input.limit });
  return { results };
}
