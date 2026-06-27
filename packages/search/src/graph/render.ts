import type { Footprint, MemoryDocument } from '@substrata/core';

import type { GraphBridge } from './query';
import type { HybridRanked, HybridResult } from './hybrid';

/**
 * Graph-aware context renderer (graph-rag-implementation.md §7). Lives in the
 * search package so BOTH the CLI command and the MCP tool render identical
 * output (the plan's "same interface for any agent" principle). Where the FTS
 * renderer emits a flat list, this emits the enriched, graph-derived sections
 * that let an LLM understand WHY memory was retrieved:
 *
 *   Relevant Memories   (+ a "Why selected" line each)
 *   Related Decisions
 *   Rejected Alternatives
 *   Related Files
 *   Related Concepts
 *
 * Sections are emitted in priority order within a token budget (ceil(chars/3.5),
 * the same approximation the FTS renderer uses), so a tight budget keeps the
 * most important section (Relevant Memories) and trims the rest.
 */

const HEADER = 'Relevant Substrata context (graph-aware):';
const CHARS_PER_TOKEN = 3.5;

/** Approximate token count for a string (ceil(chars / 3.5)). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export type GraphContextSource = {
  id: string;
  title: string;
  filePath: string;
  origin: 'fts' | 'graph';
};

export type GraphContextResult = {
  text: string;
  sources: GraphContextSource[];
};

/** First non-empty trimmed line of a block of text. */
function firstLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return undefined;
}

/** Concise one-line statement for a footprint, preferring decision-bearing sections. */
function footprintStatement(fp: Footprint): string {
  const s = fp.sections;
  if (s.decisions && s.decisions.length > 0) return s.decisions[0]!;
  if (s.rejectedOptions && s.rejectedOptions.length > 0) {
    return `Avoid ${s.rejectedOptions[0]!.option} for ${fp.title}.`;
  }
  if (s.futureAgentGuidance) return firstLine(s.futureAgentGuidance) ?? fp.title;
  return fp.title;
}

/** Concise one-line statement for a memory document (first bullet or title). */
function memoryStatement(doc: MemoryDocument): string {
  for (const line of doc.body.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('- ')) return t.slice(2).trim();
  }
  return doc.title;
}

/** Pick the most informative bridge from a graph row's provenance. */
function strongestBridge(via: GraphBridge[] | undefined): GraphBridge | undefined {
  if (!via || via.length === 0) return undefined;
  const order: Record<string, number> = { supersedes: 0, file: 1, decision: 2, concept: 3, tag: 4 };
  return [...via].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9))[0];
}

/** Human "why selected" line for a ranked row. */
function whySelected(query: string, row: HybridRanked): string {
  if (row.origin === 'fts') return `matched "${query}"`;
  const bridge = strongestBridge(row.via);
  if (!bridge) return 'graph-related to a matched memory';
  switch (bridge.kind) {
    case 'supersedes':
      return 'supersedes / superseded by a matched memory';
    case 'file':
      return `shares file ${bridge.label} with a matched memory`;
    case 'decision':
      return 'shares a decision with a matched memory';
    case 'concept':
      return `shares concept "${bridge.label}" with a matched memory`;
    case 'tag':
      return `shares tag "${bridge.label}" with a matched memory`;
    default:
      return 'graph-related to a matched memory';
  }
}

function statementFor(
  id: string,
  footprintsById: Map<string, Footprint>,
  memoryById: Map<string, MemoryDocument>,
  fallbackTitle: string,
): string {
  const fp = footprintsById.get(id);
  if (fp) return footprintStatement(fp);
  const mem = memoryById.get(id);
  if (mem) return memoryStatement(mem);
  return fallbackTitle;
}

type Section = { title: string; lines: string[] };

/** Collapse to unique, order-preserving, non-empty entries (cap length). */
function dedupe(values: Array<string | undefined>, cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v?.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Render the enriched graph context for `query` from hybrid results. Needs the
 * loaded footprints/memory to pull decisions, rejected options, and files for
 * the retrieved set (the hybrid rows carry ids + provenance, not full sections).
 */
export function renderGraphContext(
  query: string,
  hybrid: HybridResult,
  footprints: Footprint[],
  memory: MemoryDocument[],
  maxTokens: number,
  limit = 8,
): GraphContextResult {
  const footprintsById = new Map(footprints.map((f) => [f.frontmatter.id, f]));
  const memoryById = new Map(memory.map((m) => [m.frontmatter.id, m]));

  const top = hybrid.ranked.slice(0, limit);
  if (top.length === 0) {
    return { text: `${HEADER}\n\nNo relevant context found.`, sources: [] };
  }

  // Relevant Memories — the primary section, always rendered.
  const sources: GraphContextSource[] = [];
  const memoryLines: string[] = [];
  top.forEach((row, i) => {
    const statement = statementFor(row.id, footprintsById, memoryById, row.title || row.id);
    memoryLines.push(`${i + 1}. ${statement}`);
    memoryLines.push(`   Why selected: ${whySelected(query, row)}`);
    if (row.filePath) memoryLines.push(`   Source: ${row.filePath}`);
    sources.push({ id: row.id, title: row.title, filePath: row.filePath, origin: row.origin });
  });

  // Related Decisions / Rejected Alternatives — aggregated over the retrieved
  // footprints (seeds + graph-related) so the agent sees the surrounding
  // decision landscape, not just the headline.
  const rankedFootprints = top
    .map((row) => footprintsById.get(row.id))
    .filter((fp): fp is Footprint => Boolean(fp));

  const decisions = dedupe(
    rankedFootprints.flatMap((fp) =>
      (fp.sections.decisions ?? []).map((d) => `${firstLine(d) ?? d} (from ${fp.title})`),
    ),
    6,
  );

  const rejected = dedupe(
    rankedFootprints.flatMap((fp) =>
      (fp.sections.rejectedOptions ?? []).map(
        (r) => `${r.option} — ${r.reason} (from ${fp.title})`,
      ),
    ),
    6,
  );

  // Related Files / Concepts — straight from graph provenance + touched files.
  const fileBridges = hybrid.related.flatMap((r) =>
    r.bridges.filter((b) => b.kind === 'file').map((b) => b.label),
  );
  const touchedFiles = rankedFootprints.flatMap((fp) => fp.frontmatter.files_touched ?? []);
  const relatedFiles = dedupe([...fileBridges, ...touchedFiles], 8);

  const conceptBridges = hybrid.related.flatMap((r) =>
    r.bridges.filter((b) => b.kind === 'concept').map((b) => b.label),
  );
  const relatedConcepts = dedupe(conceptBridges, 10);

  // Assemble sections in priority order, stopping before the budget overflows.
  const sections: Section[] = [{ title: 'Relevant Memories', lines: memoryLines }];
  if (decisions.length > 0) {
    sections.push({ title: 'Related Decisions', lines: decisions.map((d) => `- ${d}`) });
  }
  if (rejected.length > 0) {
    sections.push({ title: 'Rejected Alternatives', lines: rejected.map((r) => `- ${r}`) });
  }
  if (relatedFiles.length > 0) {
    sections.push({ title: 'Related Files', lines: relatedFiles.map((f) => `- ${f}`) });
  }
  if (relatedConcepts.length > 0) {
    sections.push({ title: 'Related Concepts', lines: [`- ${relatedConcepts.join(', ')}`] });
  }

  const rendered: string[] = [];
  let used = estimateTokens(HEADER);
  for (const section of sections) {
    const block = `${section.title}:\n${section.lines.join('\n')}`;
    const cost = estimateTokens(`${block}\n\n`);
    // Always keep the first (Relevant Memories) section even if it overflows.
    if (rendered.length > 0 && used + cost > maxTokens) break;
    rendered.push(block);
    used += cost;
  }

  return { text: `${HEADER}\n\n${rendered.join('\n\n')}`, sources };
}
