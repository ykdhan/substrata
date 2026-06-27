import { listFootprints } from '@substrata/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTempRepo, removeDir, runCommand } from './helpers';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--no-index']);
  await runCommand(cwd, [
    'add',
    '--title',
    'Improve learner search',
    '--actor',
    'claude-code',
    '--decision',
    'Use cursor pagination instead of offset',
    '--rejected',
    'Redis cache:consistency risk and operational overhead',
    '--files',
    'api/learners.ts',
    '--tag',
    'learner-search',
  ]);
  await runCommand(cwd, [
    'add',
    '--title',
    'Refactor learner repository',
    '--actor',
    'claude-code',
    '--decision',
    'Split LearnerRepository into read and write halves',
    '--files',
    'api/learners.ts',
    '--tag',
    'refactor',
  ]);
});

afterEach(async () => {
  await removeDir(cwd);
});

describe('graph build', () => {
  it('builds the graph index and reports node/edge counts', async () => {
    const result = await runCommand(cwd, ['graph', 'build']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Graph index built');
  });
});

describe('substrata index (FTS + graph)', () => {
  it('builds both indexes when graph is enabled', async () => {
    const result = await runCommand(cwd, ['index']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Index built (FTS + graph)');
  });

  it('--no-graph skips the graph build', async () => {
    const result = await runCommand(cwd, ['index', '--no-graph']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Index built');
    expect(result.stdout).not.toContain('FTS + graph');
  });
});

describe('graph stats', () => {
  it('reports nodes and edges (text + json)', async () => {
    await runCommand(cwd, ['graph', 'build']);

    const text = await runCommand(cwd, ['graph', 'stats']);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('Nodes:');
    expect(text.stdout).toContain('Edges:');
    expect(text.stdout).toContain('footprint');

    const json = await runCommand(cwd, ['graph', 'stats', '--json']);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.totalNodes).toBeGreaterThan(0);
    expect(parsed.nodesByKind.footprint).toBeGreaterThanOrEqual(2);
    expect(parsed.edgesByRelation.TOUCHES_FILE).toBeGreaterThan(0);
  });
});

describe('graph related', () => {
  it('relates docs touching a file', async () => {
    const result = await runCommand(cwd, ['graph', 'related', 'api/learners.ts']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Improve learner search');
    expect(result.stdout).toContain('Refactor learner repository');
    expect(result.stdout).toContain('via shared file');
  });

  it('relates docs to a footprint id (--json)', async () => {
    const footprints = await listFootprints(cwd);
    const learner = footprints.find((f) => f.title === 'Improve learner search')!;
    const result = await runCommand(cwd, [
      'graph',
      'related',
      learner.frontmatter.id,
      '--id',
      '--json',
    ]);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    // The other footprint shares the api/learners.ts file → related.
    expect(parsed.some((r: { ref: string }) => r.ref !== learner.frontmatter.id)).toBe(true);
  });
});

describe('graph explain', () => {
  it('shows a path between two footprints sharing a file', async () => {
    const footprints = await listFootprints(cwd);
    const a = footprints.find((f) => f.title === 'Improve learner search')!;
    const b = footprints.find((f) => f.title === 'Refactor learner repository')!;

    const result = await runCommand(cwd, ['graph', 'explain', a.frontmatter.id, b.frontmatter.id]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Graph path');
    expect(result.stdout).toContain('api/learners.ts');
  });

  it('explains a single record’s relations when no target is given', async () => {
    const footprints = await listFootprints(cwd);
    const a = footprints.find((f) => f.title === 'Improve learner search')!;
    const result = await runCommand(cwd, ['graph', 'explain', a.frontmatter.id]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Graph-related to');
  });
});

describe('graph context', () => {
  it('renders enriched, graph-aware context', async () => {
    const result = await runCommand(cwd, ['graph', 'context', 'improve learner pagination']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Relevant Substrata context (graph-aware):');
    expect(result.stdout).toContain('Relevant Memories:');
    expect(result.stdout).toContain('Why selected:');
  });

  it('--json returns { context, sources }', async () => {
    const result = await runCommand(cwd, ['graph', 'context', 'learner pagination', '--json']);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('context');
    expect(parsed).toHaveProperty('sources');
    expect(Array.isArray(parsed.sources)).toBe(true);
  });
});
