import { describe, expect, it } from 'vitest';

import {
  extractTitle,
  parseFootprintBody,
  parseFrontmatter,
  renderFootprintBody,
  serializeFrontmatter,
} from '../src/index';
import type { FootprintSections } from '../src/index';

describe('frontmatter', () => {
  it('splits frontmatter and body', () => {
    const raw = `---\nid: x\ntags:\n  - a\n---\n\n# Title\n\nbody text\n`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({ id: 'x', tags: ['a'] });
    expect(body.trim().startsWith('# Title')).toBe(true);
  });

  it('returns empty frontmatter when absent', () => {
    const { frontmatter, body } = parseFrontmatter('# No frontmatter\n');
    expect(frontmatter).toEqual({});
    expect(body).toBe('# No frontmatter\n');
  });

  it('round-trips through serialize/parse', () => {
    const fm = { schema_version: 1, id: 'fp_1', tags: ['a', 'b'] };
    const body = '# Title\n\nSome body.';
    const serialized = serializeFrontmatter(fm, body);
    const parsed = parseFrontmatter(serialized);
    expect(parsed.frontmatter).toEqual(fm);
    expect(parsed.body.trim()).toContain('# Title');
  });
});

describe('extractTitle', () => {
  it('reads the first H1', () => {
    expect(extractTitle('# Hello World\n\nbody')).toBe('Hello World');
  });
  it('returns empty when no H1', () => {
    expect(extractTitle('no heading')).toBe('');
  });
});

describe('footprint body sections', () => {
  const sections: FootprintSections = {
    purpose: 'Reduce latency for large organizations.',
    decisions: ['Move pagination to backend.', 'Use cursor pagination.'],
    rejectedOptions: [
      { option: 'Redis cache', reason: 'Consistency risk and operational overhead.' },
      { option: 'Offset pagination', reason: 'Slower for large organizations.' },
    ],
    implementationNotes: 'Added cursor params to the endpoint.',
    commandsRun: ['pnpm test learner-search', 'pnpm typecheck'],
    memoryLearned: ['Avoid client-side filtering.', 'Use LearnerQueryService.'],
    futureAgentGuidance: 'Check LearnerQueryService first.',
  };

  it('renders and re-parses all sections (round-trip)', () => {
    const body = renderFootprintBody('Improve learner search', sections);
    expect(extractTitle(body)).toBe('Improve learner search');

    const parsed = parseFootprintBody(body);
    expect(parsed.purpose).toBe(sections.purpose);
    expect(parsed.decisions).toEqual(sections.decisions);
    expect(parsed.rejectedOptions).toEqual(sections.rejectedOptions);
    expect(parsed.implementationNotes).toBe(sections.implementationNotes);
    expect(parsed.commandsRun).toEqual(sections.commandsRun);
    expect(parsed.memoryLearned).toEqual(sections.memoryLearned);
    expect(parsed.futureAgentGuidance).toBe(sections.futureAgentGuidance);
  });

  it('omits empty sections from the rendered body', () => {
    const body = renderFootprintBody('Title only', { purpose: 'P' });
    expect(body).not.toContain('## Decisions');
    expect(body).not.toContain('## Rejected options');
    expect(body).toContain('## Purpose');
  });

  it('renders commands inside a bash code fence', () => {
    const body = renderFootprintBody('T', { commandsRun: ['pnpm test'] });
    expect(body).toContain('```bash');
    expect(body).toContain('pnpm test');
  });
});
