import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { indexPath } from '@substrata/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTempRepo, removeDir, runCommand } from './helpers';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--sharing', 'shared']);
  await runCommand(cwd, [
    'add',
    '--title',
    'Improve learner search',
    '--actor',
    'claude-code',
    '--decision',
    'Use cursor pagination',
    '--tag',
    'search',
  ]);
  await runCommand(cwd, ['index']);
});

afterEach(async () => {
  await removeDir(cwd);
});

const SQLITE_MAGIC = 'SQLite format 3\0';

describe('internal-merge-db (git merge driver)', () => {
  it('rebuilds the DB from markdown and writes a valid SQLite file to the ours path', async () => {
    // Simulate a merge conflict by clobbering the committed DB with garbage.
    writeFileSync(indexPath(cwd), 'GARBAGE-CONFLICT', 'utf8');
    const oursPath = path.join(cwd, 'ours-result.sqlite');

    const result = await runCommand(cwd, [
      'internal-merge-db',
      oursPath,
      '.substrata/index/footprint.sqlite',
    ]);
    expect(result.code).toBe(0);

    // The driver leaves a freshly rebuilt, valid SQLite DB at the ours path...
    expect(readFileSync(oursPath, 'latin1').startsWith(SQLITE_MAGIC)).toBe(true);
    // ...and the working-tree DB is no longer garbage.
    expect(readFileSync(indexPath(cwd), 'latin1').startsWith(SQLITE_MAGIC)).toBe(true);
  });
});
