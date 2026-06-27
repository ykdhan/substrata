import { listFootprints, listMemoryDocuments, writeFootprint } from '@substrata/core';
import { buildIndex, hybridSearch } from '@substrata/search';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderGraphContext } from '../src/render/graph-context';

import { makeTempRepo, removeDir, runCommand } from './helpers';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--no-index']);

  // A directly matches the query and carries a decision + rejected option.
  await writeFootprint({
    cwd,
    title: 'Improve learner search performance',
    actor: 'claude-code',
    decisions: ['Use cursor pagination instead of offset.'],
    rejectedOptions: [{ option: 'Redis cache', reason: 'Consistency risk.' }],
    filesTouched: ['api/learners.ts'],
    tags: ['learner-search'],
  });
  // B shares the file with A but does NOT match the query → graph-only.
  await writeFootprint({
    cwd,
    title: 'Refactor learner repository',
    actor: 'claude-code',
    decisions: ['Split LearnerRepository into read/write halves.'],
    filesTouched: ['api/learners.ts'],
    tags: ['refactor'],
  });
  await buildIndex(cwd);
});

afterEach(async () => {
  await removeDir(cwd);
});

describe('renderGraphContext', () => {
  it('emits enriched sections with a Why selected line per memory', async () => {
    const [footprints, memory] = await Promise.all([listFootprints(cwd), listMemoryDocuments(cwd)]);
    const hybrid = await hybridSearch('cursor pagination', { cwd, graphEnabled: true });
    const rendered = renderGraphContext('cursor pagination', hybrid, footprints, memory, 2000);

    expect(rendered.text).toContain('Relevant Substrata context (graph-aware):');
    expect(rendered.text).toContain('Relevant Memories:');
    expect(rendered.text).toContain('Why selected:');
    expect(rendered.text).toContain('Related Decisions:');
    expect(rendered.text).toContain('Rejected Alternatives:');
    expect(rendered.text).toContain('Related Files:');
    // The matched memory's Why-selected references the query.
    expect(rendered.text).toContain('matched "cursor pagination"');
    // At least one source is present.
    expect(rendered.sources.length).toBeGreaterThan(0);
  });

  it('marks a graph-surfaced doc with a shared-file Why selected', async () => {
    const [footprints, memory] = await Promise.all([listFootprints(cwd), listMemoryDocuments(cwd)]);
    const hybrid = await hybridSearch('cursor pagination', { cwd, graphEnabled: true });
    const rendered = renderGraphContext('cursor pagination', hybrid, footprints, memory, 2000);

    // B ("Refactor learner repository") is surfaced via the shared api/learners.ts file.
    const graphSource = rendered.sources.find((s) => s.origin === 'graph');
    expect(graphSource).toBeDefined();
    expect(rendered.text).toContain('shares file api/learners.ts with a matched memory');
  });

  it('keeps the Relevant Memories section under a tiny token budget', async () => {
    const [footprints, memory] = await Promise.all([listFootprints(cwd), listMemoryDocuments(cwd)]);
    const hybrid = await hybridSearch('cursor pagination', { cwd, graphEnabled: true });
    const small = renderGraphContext('cursor pagination', hybrid, footprints, memory, 40);

    expect(small.text).toContain('Relevant Memories:');
    // The budget is too small for every section, so a later one is trimmed.
    expect(small.text).not.toContain('Related Concepts:');
  });
});
