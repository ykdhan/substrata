import { existsSync } from 'node:fs';

import { indexPath } from '@substrata/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTempRepo, removeDir, runCommand } from './helpers';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  // init WITHOUT building the index, so search/context must lazily build it.
  await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--no-index']);
  await runCommand(cwd, [
    'add',
    '--title',
    'Improve learner search performance',
    '--purpose',
    'Reduce latency for large orgs',
    '--actor',
    'claude-code',
    '--files',
    'api/learners.ts',
    '--tag',
    'performance',
    '--decision',
    'Use cursor pagination instead of offset',
    '--rejected',
    'Redis cache:consistency risk and operational overhead',
  ]);
});

afterEach(async () => {
  await removeDir(cwd);
});

describe('search', () => {
  it('auto-builds a missing index and returns results', async () => {
    expect(existsSync(indexPath(cwd))).toBe(false);
    const result = await runCommand(cwd, ['search', 'learner pagination']);
    expect(result.code).toBe(0);
    expect(existsSync(indexPath(cwd))).toBe(true);
    expect(result.stdout).toContain('learner search performance');
  });

  it('--json returns an array of results', async () => {
    const result = await runCommand(cwd, ['search', 'learner', '--json']);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty('id');
    expect(parsed[0]).toHaveProperty('score');
  });
});

describe('context', () => {
  it('returns LLM-friendly context with Source paths', async () => {
    const result = await runCommand(cwd, ['context', 'improve learner search']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Relevant Substrata context:');
    expect(result.stdout).toContain('Source:');
  });

  it('--json returns { context, sources }', async () => {
    const result = await runCommand(cwd, ['context', 'learner search', '--json']);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('context');
    expect(parsed).toHaveProperty('sources');
    expect(Array.isArray(parsed.sources)).toBe(true);
  });

  it('respects a tiny token budget (fewer/shorter output)', async () => {
    const big = await runCommand(cwd, [
      'context',
      'learner search',
      '--json',
      '--max-tokens',
      '2000',
    ]);
    const small = await runCommand(cwd, [
      'context',
      'learner search',
      '--json',
      '--max-tokens',
      '40',
    ]);
    const bigParsed = JSON.parse(big.stdout);
    const smallParsed = JSON.parse(small.stdout);
    expect(smallParsed.sources.length).toBeLessThanOrEqual(bigParsed.sources.length);
  });
});
