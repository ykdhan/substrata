// Graph Memory / Graph RAG MCP tools (graph-rag-implementation.md §10).
//
// Four tools that mirror the `substrata graph …` CLI subcommands so any agent
// gets the same graph interface over MCP. All of them auto-(re)build the graph
// on first use and fail open (the underlying @substrata/search graph functions
// return empty results rather than throwing on a corrupt/absent graph).

import { listFootprints, listMemoryDocuments, loadConfig } from '@substrata/core';
import {
  explainGraphPath,
  graphRelatedToFile,
  graphRelatedToIds,
  graphStats,
  hybridSearch,
  renderGraphContext,
  type ExplainResult,
  type GraphRelatedResult,
  type GraphStats,
} from '@substrata/search';
import { z } from 'zod';

import { ensureIndexFresh } from './search';
import { recordRead } from './telemetry';

/** Heuristic: does this target look like a file path rather than a footprint id? */
function looksLikeFile(target: string): boolean {
  return target.includes('/') || target.includes('\\') || /\.[a-z0-9]+$/i.test(target);
}

// ── substrata_graph_context ────────────────────────────────────────────────

export const graphContextInputShape = {
  task: z.string().describe('What the agent is about to do; used to retrieve graph-aware memory.'),
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

export type GraphContextInput = { task: string; files?: string[]; maxTokens?: number };

export async function runGraphContext(
  input: GraphContextInput,
  cwd: string,
): Promise<{ context: string; sources: unknown[] }> {
  await ensureIndexFresh(cwd);
  const config = await loadConfig(cwd);
  const maxTokens = input.maxTokens ?? config.search.max_context_tokens;

  const hybrid = await hybridSearch(input.task, {
    cwd,
    limit: config.search.default_limit,
    files: input.files,
    excludeSuperseded: true,
    graphEnabled: config.graph.enabled,
    graphLimit: config.search.default_limit,
    depth: config.graph.expansion_depth,
    maxNodes: config.graph.max_nodes,
    maxEdges: config.graph.max_edges,
  });

  const [footprints, memory] = await Promise.all([listFootprints(cwd), listMemoryDocuments(cwd)]);
  const rendered = renderGraphContext(
    input.task,
    hybrid,
    footprints,
    memory,
    maxTokens,
    config.search.default_limit,
  );

  await recordRead(cwd, {
    op: 'context',
    query: input.task,
    resultCount: rendered.sources.length,
    returnedIds: rendered.sources.map((s) => s.id),
    source: 'mcp',
  });
  return { context: rendered.text, sources: rendered.sources };
}

// ── substrata_graph_related ────────────────────────────────────────────────

export const graphRelatedInputShape = {
  target: z.string().describe('A footprint id or a file path to find graph-related records for.'),
  file: z.boolean().optional().describe('Force treating <target> as a file path.'),
  limit: z.number().int().positive().optional().describe('Maximum number of results.'),
  excludeSuperseded: z.boolean().optional().describe('Drop superseded/deprecated records.'),
} as const;

export type GraphRelatedInput = {
  target: string;
  file?: boolean;
  limit?: number;
  excludeSuperseded?: boolean;
};

export async function runGraphRelated(
  input: GraphRelatedInput,
  cwd: string,
): Promise<{ results: GraphRelatedResult[] }> {
  const config = await loadConfig(cwd);
  const opts = {
    cwd,
    limit: input.limit ?? config.search.default_limit,
    depth: config.graph.expansion_depth,
    maxNodes: config.graph.max_nodes,
    maxEdges: config.graph.max_edges,
    excludeSuperseded: input.excludeSuperseded,
  };
  const asFile = input.file || looksLikeFile(input.target);
  const results = asFile
    ? await graphRelatedToFile(input.target, opts)
    : await graphRelatedToIds([input.target], opts);

  await recordRead(cwd, {
    op: 'related',
    query: input.target,
    resultCount: results.length,
    returnedIds: results.map((r) => r.ref),
    source: 'mcp',
  });
  return { results };
}

// ── substrata_graph_explain ────────────────────────────────────────────────

export const graphExplainInputShape = {
  from: z.string().describe('Footprint id to explain from.'),
  to: z
    .string()
    .optional()
    .describe('Optional second footprint id; when given, returns the shortest path between them.'),
} as const;

export type GraphExplainInput = { from: string; to?: string };

export async function runGraphExplain(
  input: GraphExplainInput,
  cwd: string,
): Promise<{ path?: ExplainResult; related?: GraphRelatedResult[] }> {
  const config = await loadConfig(cwd);
  if (input.to) {
    const path = await explainGraphPath(cwd, input.from, input.to);
    await recordRead(cwd, {
      op: 'related',
      query: `${input.from} -> ${input.to}`,
      resultCount: path.found ? 1 : 0,
      source: 'mcp',
    });
    return { path };
  }

  const related = await graphRelatedToIds([input.from], {
    cwd,
    limit: config.search.default_limit,
    depth: config.graph.expansion_depth,
    maxNodes: config.graph.max_nodes,
    maxEdges: config.graph.max_edges,
  });
  await recordRead(cwd, {
    op: 'related',
    query: input.from,
    resultCount: related.length,
    returnedIds: related.map((r) => r.ref),
    source: 'mcp',
  });
  return { related };
}

// ── substrata_graph_stats ──────────────────────────────────────────────────

export const graphStatsInputShape = {
  topN: z.number().int().positive().optional().describe('How many most-connected records to list.'),
} as const;

export type GraphStatsInput = { topN?: number };

export async function runGraphStats(input: GraphStatsInput, cwd: string): Promise<GraphStats> {
  return graphStats(cwd, { topN: input.topN });
}
