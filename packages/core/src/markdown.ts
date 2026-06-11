import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { FootprintSections, RejectedOption } from './types';

/**
 * Frontmatter + section rendering/parsing for footprint markdown bodies.
 *
 * Frontmatter uses the `yaml` package. Body sections follow the layout in
 * plan §5 (Purpose, Decisions, Rejected options, Implementation notes,
 * Commands run, Memory learned, Future agent guidance).
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export type ParsedFrontmatter = {
  /** Parsed YAML frontmatter object (empty object when none present). */
  frontmatter: Record<string, unknown>;
  /** Body text after the closing `---`. */
  body: string;
};

/** Split a raw markdown document into frontmatter + body. */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const parsed = parseYaml(match[1]!) as unknown;
  const frontmatter =
    parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  return { frontmatter, body: match[2] ?? '' };
}

/** Serialize a frontmatter object and body back into a markdown document. */
export function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd();
  const trimmedBody = body.replace(/^\r?\n+/, '');
  return `---\n${yaml}\n---\n\n${trimmedBody.length > 0 ? `${trimmedBody.replace(/\s+$/, '')}\n` : ''}`;
}

/** Title is the first level-1 heading; returns '' if absent. */
export function extractTitle(body: string): string {
  const match = /^#\s+(.+?)\s*$/m.exec(body);
  return match ? match[1]!.trim() : '';
}

// --- Section rendering -------------------------------------------------------

function renderListSection(heading: string, items: string[] | undefined): string | null {
  if (!items || items.length === 0) return null;
  const lines = items.map((item) => `- ${item}`);
  return `## ${heading}\n\n${lines.join('\n')}`;
}

function renderProseSection(heading: string, text: string | undefined): string | null {
  if (!text || text.trim().length === 0) return null;
  return `## ${heading}\n\n${text.trim()}`;
}

function renderRejectedOptions(options: RejectedOption[] | undefined): string | null {
  if (!options || options.length === 0) return null;
  const blocks = options.map((o) => `### ${o.option}\n\n${o.reason.trim()}`);
  return `## Rejected options\n\n${blocks.join('\n\n')}`;
}

function renderCommands(commands: string[] | undefined): string | null {
  if (!commands || commands.length === 0) return null;
  return `## Commands run\n\n\`\`\`bash\n${commands.join('\n')}\n\`\`\``;
}

/**
 * Render the full footprint body from a title and structured sections.
 * Only non-empty sections are emitted, in canonical order.
 */
export function renderFootprintBody(title: string, sections: FootprintSections): string {
  const parts: Array<string | null> = [
    `# ${title}`,
    renderProseSection('Purpose', sections.purpose),
    renderListSection('Decisions', sections.decisions),
    renderRejectedOptions(sections.rejectedOptions),
    renderProseSection('Implementation notes', sections.implementationNotes),
    renderCommands(sections.commandsRun),
    renderListSection('Memory learned', sections.memoryLearned),
    renderProseSection('Future agent guidance', sections.futureAgentGuidance),
  ];
  return `${parts.filter((p): p is string => p !== null).join('\n\n')}\n`;
}

// --- Section parsing ---------------------------------------------------------

type RawSection = { heading: string; content: string };

/** Split a body into level-2 (`##`) sections, ignoring the title and preamble. */
function splitSections(body: string): RawSection[] {
  const lines = body.split(/\r?\n/);
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  let inFence = false;

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      if (current) current.content += `${line}\n`;
      continue;
    }
    const headingMatch = !inFence ? /^##\s+(.+?)\s*$/.exec(line) : null;
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[1]!.trim(), content: '' };
      continue;
    }
    if (current) current.content += `${line}\n`;
  }
  if (current) sections.push(current);
  return sections;
}

function parseListItems(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter((l) => l.length > 0);
}

function parseProse(content: string): string {
  return content.trim();
}

function parseCommands(content: string): string[] {
  const fenceMatch = /```(?:bash|sh)?\r?\n([\s\S]*?)```/.exec(content);
  const inner = fenceMatch ? fenceMatch[1]! : content;
  return inner
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function parseRejectedOptions(content: string): RejectedOption[] {
  const options: RejectedOption[] = [];
  const parts = content.split(/^###\s+/m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const newlineIdx = trimmed.indexOf('\n');
    if (newlineIdx === -1) {
      options.push({ option: trimmed, reason: '' });
      continue;
    }
    const option = trimmed.slice(0, newlineIdx).trim();
    const reason = trimmed.slice(newlineIdx + 1).trim();
    options.push({ option, reason });
  }
  return options;
}

/** Parse a footprint body into structured sections. Headings are case-insensitive. */
export function parseFootprintBody(body: string): FootprintSections {
  const sections: FootprintSections = {};
  for (const raw of splitSections(body)) {
    const key = raw.heading.toLowerCase();
    switch (key) {
      case 'purpose':
        sections.purpose = parseProse(raw.content);
        break;
      case 'decisions':
        sections.decisions = parseListItems(raw.content);
        break;
      case 'rejected options':
        sections.rejectedOptions = parseRejectedOptions(raw.content);
        break;
      case 'implementation notes':
        sections.implementationNotes = parseProse(raw.content);
        break;
      case 'commands run':
        sections.commandsRun = parseCommands(raw.content);
        break;
      case 'memory learned':
        sections.memoryLearned = parseListItems(raw.content);
        break;
      case 'future agent guidance':
        sections.futureAgentGuidance = parseProse(raw.content);
        break;
      default:
        break;
    }
  }
  return sections;
}
