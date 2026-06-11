import type { Footprint, MemoryDocument, SearchResult } from '@substrata/core';

/**
 * Build the LLM-friendly `context` output (plan §8.4). Each ranked source is
 * rendered as a numbered point with a one-line statement, an optional Reason,
 * and a Source: path. Sources are added in ranked order until adding the next
 * one would exceed the token budget.
 *
 * Token budget is a documented character approximation: `ceil(chars / 3.5)`.
 * No real tokenizer is bundled (plan §8.4). We round up so the estimate
 * under-fills rather than overflows.
 */

const CHARS_PER_TOKEN = 3.5;

/** Approximate token count for a string (ceil(chars / 3.5)). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export type ContextSource = {
  id: string;
  title: string;
  filePath: string;
};

export type ContextResult = {
  text: string;
  sources: ContextSource[];
};

const HEADER = 'Relevant Substrata context:';
const APPROX_NOTE = '(Token counts are approximate — estimated, not tokenizer-exact.)';

/** First non-empty line of a block of text, trimmed. */
function firstLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return undefined;
}

/**
 * Derive a concise statement + optional reason for a footprint, preferring the
 * most decision-bearing section available.
 */
function footprintPoint(fp: Footprint): { statement: string; reason?: string } {
  const s = fp.sections;
  if (s.decisions && s.decisions.length > 0) {
    const rejected = s.rejectedOptions?.[0];
    return {
      statement: s.decisions[0]!,
      reason: rejected ? `${rejected.option} was rejected — ${rejected.reason}` : undefined,
    };
  }
  if (s.rejectedOptions && s.rejectedOptions.length > 0) {
    const r = s.rejectedOptions[0]!;
    return { statement: `Avoid ${r.option} for ${fp.title}.`, reason: r.reason };
  }
  if (s.futureAgentGuidance) {
    return { statement: firstLine(s.futureAgentGuidance) ?? fp.title };
  }
  if (s.purpose) {
    return { statement: fp.title, reason: firstLine(s.purpose) };
  }
  return { statement: fp.title };
}

/** Derive a concise statement for a memory document (first bullet or title). */
function memoryPoint(doc: MemoryDocument): { statement: string } {
  for (const line of doc.body.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('- ')) return { statement: t.slice(2).trim() };
  }
  return { statement: doc.title };
}

type Resolved = { source: ContextSource; block: string };

function blockFor(
  result: SearchResult,
  footprintsById: Map<string, Footprint>,
  memoryById: Map<string, MemoryDocument>,
  index: number,
): Resolved {
  const fp = footprintsById.get(result.id);
  const mem = memoryById.get(result.id);

  let statement: string;
  let reason: string | undefined;
  if (fp) {
    ({ statement, reason } = footprintPoint(fp));
  } else if (mem) {
    ({ statement } = memoryPoint(mem));
  } else {
    statement = result.title || result.id;
  }

  const lines = [`${index}. ${statement}`];
  if (reason) lines.push(`   Reason: ${reason}`);
  lines.push(`   Source: ${result.filePath}`);

  return {
    source: { id: result.id, title: result.title, filePath: result.filePath },
    block: lines.join('\n'),
  };
}

/**
 * Render ranked results into the LLM-friendly context string within a token
 * budget. Adds sources in order until the next would overflow `maxTokens`.
 */
export function renderContext(
  results: SearchResult[],
  footprints: Footprint[],
  memory: MemoryDocument[],
  maxTokens: number,
): ContextResult {
  const footprintsById = new Map(footprints.map((f) => [f.frontmatter.id, f]));
  const memoryById = new Map(memory.map((m) => [m.frontmatter.id, m]));

  const header = `${HEADER}\n\n`;
  const footer = `\n\n${APPROX_NOTE}`;
  let used = estimateTokens(header) + estimateTokens(footer);

  const chosen: ContextSource[] = [];
  const blocks: string[] = [];

  let n = 1;
  for (const result of results) {
    const { source, block } = blockFor(result, footprintsById, memoryById, n);
    const blockTokens = estimateTokens(`${block}\n\n`);
    if (used + blockTokens > maxTokens && blocks.length > 0) break;
    blocks.push(block);
    chosen.push(source);
    used += blockTokens;
    n += 1;
  }

  if (blocks.length === 0) {
    return { text: `${HEADER}\n\nNo relevant context found.`, sources: [] };
  }

  return { text: `${header}${blocks.join('\n\n')}${footer}`, sources: chosen };
}
