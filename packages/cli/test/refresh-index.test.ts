import { appendFileSync, readFileSync } from 'node:fs';

import { listFootprints } from '@substrata/core';
import { getGraphStatus, getIndexStatus } from '@substrata/index';
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
    'Use cursor pagination',
    '--tag',
    'search',
  ]);
});

afterEach(async () => {
  await removeDir(cwd);
});

describe('internal-refresh-index', () => {
  it('builds FTS + graph when missing/stale, and re-freshens after a content change', async () => {
    // Index was skipped at init, so it is missing.
    expect((await getIndexStatus(cwd)).state).toBe('missing');

    const first = await runCommand(cwd, ['internal-refresh-index']);
    expect(first.code).toBe(0);
    expect(await getIndexStatus(cwd)).toEqual({ state: 'fresh' });
    expect((await getGraphStatus(cwd)).state).toBe('fresh');

    // A real content change makes it stale...
    const fp = (await listFootprints(cwd))[0]!;
    appendFileSync(fp.filePath, '\n\nNew decision text.\n', 'utf8');
    expect((await getIndexStatus(cwd)).state).toBe('stale');

    // ...and a refresh brings it back to fresh.
    const second = await runCommand(cwd, ['internal-refresh-index']);
    expect(second.code).toBe(0);
    expect(await getIndexStatus(cwd)).toEqual({ state: 'fresh' });
  });

  it('is a safe no-op when already fresh (exits 0, does not rewrite)', async () => {
    await runCommand(cwd, ['internal-refresh-index']);
    const { indexPath } = await import('@substrata/core');
    const before = readFileSync(indexPath(cwd));

    const again = await runCommand(cwd, ['internal-refresh-index']);
    expect(again.code).toBe(0);
    // No rebuild → file untouched (fresh short-circuits before any write).
    expect(readFileSync(indexPath(cwd)).equals(before)).toBe(true);
  });
});
