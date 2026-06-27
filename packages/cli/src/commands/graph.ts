import { listFootprints, listMemoryDocuments } from '@substrata/core';
import {
  buildGraph,
  explainGraphPath,
  graphRelatedToFile,
  graphRelatedToIds,
  graphStats,
  hybridSearch,
  type ExplainResult,
  type GraphBridge,
  type GraphRelatedResult,
  type GraphStats,
} from '@substrata/search';
import type { Command } from 'commander';

import { renderGraphContext } from '../render/graph-context';
import { out, recordAccess, requireConfig, resolveCwd } from '../util';

import { ensureFreshIndex } from './auto-index';

/**
 * `substrata graph …` — the Graph Memory / Graph RAG command group
 * (graph-rag-implementation.md §9). Every capability here is also exposed over
 * MCP so any agent gets the same interface. All subcommands degrade gracefully:
 * the graph index auto-(re)builds on first use and reads fail open.
 */

type JsonOption = { json?: boolean };

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** Heuristic: does this target look like a file path rather than a footprint id? */
function looksLikeFile(target: string): boolean {
  return target.includes('/') || target.includes('\\') || /\.[a-z0-9]+$/i.test(target);
}

/** Summarize a candidate's bridges into a human "via …" reason line. */
function reasonLine(bridges: GraphBridge[]): string {
  const byKind = new Map<string, Set<string>>();
  for (const b of bridges) {
    const label = b.kind === 'supersedes' ? '' : b.label;
    const set = byKind.get(b.kind) ?? new Set<string>();
    if (label) set.add(label);
    byKind.set(b.kind, set);
  }
  const parts: string[] = [];
  for (const [kind, labels] of byKind) {
    if (kind === 'supersedes') parts.push('supersedes link');
    else if (labels.size > 0) parts.push(`shared ${kind} ${[...labels].slice(0, 3).join(', ')}`);
    else parts.push(`shared ${kind}`);
  }
  return parts.join('; ');
}

function renderRelated(target: string, results: GraphRelatedResult[]): string {
  if (results.length === 0) return `No graph-related records for ${target}.`;
  const lines = [`Graph-related to ${target} (${results.length}):`, ''];
  results.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.label}  [score ${r.score.toFixed(2)}]`);
    const reason = reasonLine(r.bridges);
    if (reason) lines.push(`   via ${reason}`);
    if (r.filePath) lines.push(`   Source: ${r.filePath}`);
  });
  return lines.join('\n');
}

function renderExplain(from: string, to: string, result: ExplainResult): string {
  if (!result.found) {
    return `No graph path found between ${from} and ${to} (within depth).`;
  }
  const lines = [`Graph path from ${from} to ${to}:`, ''];
  result.path.forEach((hop, i) => {
    if (i === 0) {
      lines.push(`  ${hop.node.label} (${hop.node.kind})`);
    } else {
      lines.push(`    ──${hop.rel ?? 'RELATED'}──▶ ${hop.node.label} (${hop.node.kind})`);
    }
  });
  return lines.join('\n');
}

function renderStats(stats: GraphStats): string {
  const lines: string[] = [];
  lines.push(stats.builtAt ? `Graph index stats (built ${stats.builtAt}):` : 'Graph index stats:');
  lines.push('');
  lines.push(`Nodes: ${stats.totalNodes}`);
  for (const [kind, count] of Object.entries(stats.nodesByKind).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${kind.padEnd(16)} ${count}`);
  }
  lines.push('');
  lines.push(`Edges: ${stats.totalEdges}`);
  for (const [rel, count] of Object.entries(stats.edgesByRelation).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${rel.padEnd(16)} ${count}`);
  }
  if (stats.topConnected.length > 0) {
    lines.push('');
    lines.push('Most connected:');
    stats.topConnected.forEach((n, i) => {
      lines.push(`  ${i + 1}. ${n.label} (${n.kind}) — degree ${n.degree}`);
    });
  }
  return lines.join('\n');
}

export function registerGraphCommand(program: Command): void {
  const graph = program
    .command('graph')
    .description('Graph Memory / Graph RAG: build, related, explain, stats, context')
    .enablePositionalOptions();

  graph
    .command('build')
    .description('Build or rebuild the graph index (alongside the FTS index)')
    .action(async (_opts: unknown, command: Command) => {
      const cwd = resolveCwd(command.parent?.parent?.opts());
      await requireConfig(cwd);
      await buildGraph(cwd);
      const stats = await graphStats(cwd);
      out.ok(`Graph index built (${stats.totalNodes} nodes, ${stats.totalEdges} edges).`);
    });

  graph
    .command('related <target>')
    .description('Find records graph-related to a footprint id or file path')
    .option('--file', 'Treat <target> as a file path')
    .option('--id', 'Treat <target> as a footprint id')
    .option('--limit <n>', 'Maximum number of results')
    .option('--exclude-superseded', 'Drop superseded/deprecated records')
    .option('--json', 'Output JSON')
    .action(
      async (
        target: string,
        opts: JsonOption & {
          file?: boolean;
          id?: boolean;
          limit?: string;
          excludeSuperseded?: boolean;
        },
        command: Command,
      ) => {
        const cwd = resolveCwd(command.parent?.parent?.opts());
        const config = await requireConfig(cwd);
        const limit = opts.limit ? Number(opts.limit) : config.search.default_limit;
        const asFile = opts.file || (!opts.id && looksLikeFile(target));

        const results = asFile
          ? await graphRelatedToFile(target, {
              cwd,
              limit,
              maxNodes: config.graph.max_nodes,
              maxEdges: config.graph.max_edges,
              depth: config.graph.expansion_depth,
              excludeSuperseded: opts.excludeSuperseded,
            })
          : await graphRelatedToIds([target], {
              cwd,
              limit,
              maxNodes: config.graph.max_nodes,
              maxEdges: config.graph.max_edges,
              depth: config.graph.expansion_depth,
              excludeSuperseded: opts.excludeSuperseded,
            });

        recordAccess(cwd, config, {
          op: 'related',
          query: target,
          resultCount: results.length,
          returnedIds: results.map((r) => r.ref),
          source: 'cli',
        });

        if (opts.json) {
          out.plain(JSON.stringify(results, null, 2));
          return;
        }
        out.plain(renderRelated(target, results));
      },
    );

  graph
    .command('explain <from> [to]')
    .description('Explain WHY two records are connected (shortest graph path)')
    .option('--json', 'Output JSON')
    .action(async (from: string, to: string | undefined, opts: JsonOption, command: Command) => {
      const cwd = resolveCwd(command.parent?.parent?.opts());
      const config = await requireConfig(cwd);

      if (!to) {
        // No target: explain the record's relations (which docs it links to + why).
        const results = await graphRelatedToIds([from], {
          cwd,
          limit: config.search.default_limit,
          maxNodes: config.graph.max_nodes,
          maxEdges: config.graph.max_edges,
          depth: config.graph.expansion_depth,
        });
        recordAccess(cwd, config, {
          op: 'related',
          query: from,
          resultCount: results.length,
          returnedIds: results.map((r) => r.ref),
          source: 'cli',
        });
        if (opts.json) {
          out.plain(JSON.stringify(results, null, 2));
          return;
        }
        out.plain(renderRelated(from, results));
        return;
      }

      const result = await explainGraphPath(cwd, from, to);
      recordAccess(cwd, config, {
        op: 'related',
        query: `${from} -> ${to}`,
        resultCount: result.found ? 1 : 0,
        source: 'cli',
      });
      if (opts.json) {
        out.plain(JSON.stringify(result, null, 2));
        return;
      }
      out.plain(renderExplain(from, to, result));
    });

  graph
    .command('stats')
    .description('Report graph index node/edge counts and most-connected records')
    .option('--json', 'Output JSON')
    .action(async (opts: JsonOption, command: Command) => {
      const cwd = resolveCwd(command.parent?.parent?.opts());
      await requireConfig(cwd);
      const stats = await graphStats(cwd);
      if (opts.json) {
        out.plain(JSON.stringify(stats, null, 2));
        return;
      }
      out.plain(renderStats(stats));
    });

  graph
    .command('context <task>')
    .description('Graph-aware, source-linked context for an agent (enriched sections)')
    .option('--json', 'Output JSON ({ context, sources })')
    .option('--max-tokens <n>', 'Approximate token budget (chars/3.5)')
    .option('--files <path>', 'Bias toward docs touching this file (repeatable)', collect, [])
    .option('--no-auto-index', 'Do not auto-(re)build a stale/missing index')
    .action(
      async (
        task: string,
        opts: JsonOption & { maxTokens?: string; files?: string[]; autoIndex?: boolean },
        command: Command,
      ) => {
        const cwd = resolveCwd(command.parent?.parent?.opts());
        const config = await requireConfig(cwd);

        await ensureFreshIndex(cwd, opts.autoIndex !== false);

        const maxTokens = opts.maxTokens
          ? Number(opts.maxTokens)
          : config.search.max_context_tokens;
        const budget = Number.isFinite(maxTokens) ? maxTokens : config.search.max_context_tokens;

        const hybrid = await hybridSearch(task, {
          cwd,
          limit: config.search.default_limit,
          files: opts.files && opts.files.length > 0 ? opts.files : undefined,
          excludeSuperseded: true,
          graphEnabled: config.graph.enabled,
          graphLimit: config.search.default_limit,
          depth: config.graph.expansion_depth,
          maxNodes: config.graph.max_nodes,
          maxEdges: config.graph.max_edges,
          // --no-auto-index suppresses BOTH the FTS rebuild (above) and the graph
          // rebuild, so the command reads only what is already on disk.
          autoBuild: opts.autoIndex !== false,
        });

        const [footprints, memory] = await Promise.all([
          listFootprints(cwd),
          listMemoryDocuments(cwd),
        ]);

        const rendered = renderGraphContext(
          task,
          hybrid,
          footprints,
          memory,
          budget,
          config.search.default_limit,
        );

        recordAccess(cwd, config, {
          op: 'context',
          query: task,
          resultCount: rendered.sources.length,
          returnedIds: rendered.sources.map((s) => s.id),
          source: 'cli',
        });

        if (opts.json) {
          out.plain(JSON.stringify({ context: rendered.text, sources: rendered.sources }, null, 2));
          return;
        }
        out.plain(rendered.text);
      },
    );
}
