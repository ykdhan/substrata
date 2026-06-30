import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTempRepo, removeDir, runCommand } from './helpers';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--no-index']);
  await runCommand(cwd, [
    'add',
    '--title',
    'Improve learner search performance',
    '--actor',
    'claude-code',
    '--decision',
    'Use cursor pagination instead of offset',
    '--files',
    'api/learners.ts',
    '--tag',
    'learner-search',
  ]);
  await runCommand(cwd, [
    'add',
    '--title',
    'Adopt event sourcing for billing',
    '--actor',
    'claude-code',
    '--decision',
    'Model billing as an append-only event log',
    '--files',
    'billing/EventStore.ts',
    '--tag',
    'billing',
  ]);
});

afterEach(async () => {
  await removeDir(cwd);
});

describe('substrata bench', () => {
  it('--json reports a token reduction vs the whole-corpus baseline', async () => {
    const result = await runCommand(cwd, ['bench', '--json', 'learner search performance']);
    expect(result.code).toBe(0);

    const report = JSON.parse(result.stdout);
    expect(report.corpusDocs).toBeGreaterThanOrEqual(2);
    expect(report.baselineTokens).toBeGreaterThan(0);
    expect(report.substrataTokens).toBeLessThan(report.baselineTokens);
    expect(report.reductionPct).toBeGreaterThan(0);
    expect(Array.isArray(report.perQuery)).toBe(true);
    expect(report.perQuery[0].query).toBe('learner search performance');
  });

  it('prints a human table and uses footprint titles when no query is given', async () => {
    const result = await runCommand(cwd, ['bench']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Substrata benchmark');
    expect(result.stdout).toMatch(/fewer/);
  });
});
