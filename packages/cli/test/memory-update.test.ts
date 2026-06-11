import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTempRepo, removeDir, runCommand } from './helpers';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);
  await runCommand(cwd, [
    'add',
    '--title',
    'Learner search work',
    '--actor',
    'claude-code',
    '--memory',
    'Learner DB access goes through LearnerQueryService',
    '--memory',
    'Avoid client-side filtering for org data',
  ]);
});

afterEach(async () => {
  await removeDir(cwd);
});

describe('memory update', () => {
  it('appends entries before the end marker (idempotent)', async () => {
    const conventions = path.join(cwd, '.substrata', 'memory', 'conventions.md');

    const first = await runCommand(cwd, ['memory', 'update', '--yes']);
    expect(first.code).toBe(0);

    const afterFirst = readFileSync(conventions, 'utf8');
    expect(afterFirst).toContain('LearnerQueryService');
    expect(afterFirst).toContain('<!-- substrata:entries:end -->');
    // Entry block sits before the end marker.
    expect(afterFirst.indexOf('LearnerQueryService')).toBeLessThan(
      afterFirst.indexOf('<!-- substrata:entries:end -->'),
    );

    // Re-running must not duplicate the entry.
    await runCommand(cwd, ['memory', 'update', '--yes']);
    const afterSecond = readFileSync(conventions, 'utf8');
    const occurrences = afterSecond.split('LearnerQueryService').length - 1;
    expect(occurrences).toBe(1);
  });
});
