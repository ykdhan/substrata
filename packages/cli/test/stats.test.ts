import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTempRepo, removeDir, runCommand } from './helpers';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--no-claude-hooks']);
});

afterEach(async () => {
  await removeDir(cwd);
});

describe('stats', () => {
  it('reports reads logged by search/context/list and the read:write ratio', async () => {
    await runCommand(cwd, [
      'add',
      '--title',
      'Use cursor pagination',
      '--actor',
      'a',
      '--decision',
      'Adopt keyset pagination',
    ]);
    await runCommand(cwd, ['add', '--title', 'Unrelated note', '--actor', 'a']);

    // Three reads across the logged ops.
    await runCommand(cwd, ['search', 'pagination']);
    await runCommand(cwd, ['context', 'how should I paginate']);
    await runCommand(cwd, ['list']);

    const res = await runCommand(cwd, ['stats', '--json']);
    expect(res.code).toBe(0);
    const stats = JSON.parse(res.stdout);

    expect(stats.totalReads).toBe(3);
    expect(stats.byOp.search).toBe(1);
    expect(stats.byOp.context).toBe(1);
    expect(stats.byOp.list).toBe(1);
    expect(stats.bySource.cli).toBe(3);
    expect(stats.totalWrites).toBe(2);
    expect(stats.totalFootprints).toBe(2);
    // The pagination footprint was returned by search+context+list, so it has hits.
    expect(stats.mostReferenced[0].title).toBe('Use cursor pagination');
    expect(stats.mostReferenced[0].hits).toBe(3);
  });

  it('human output nudges when there are no reads yet', async () => {
    const res = await runCommand(cwd, ['stats']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('reads:writes');
    expect(res.stdout + res.stderr).toContain('No reads logged yet');
  });

  it('survives an index rebuild (separate DB file)', async () => {
    await runCommand(cwd, ['add', '--title', 'Keep me', '--actor', 'a']);
    await runCommand(cwd, ['search', 'keep']);
    // Force a full index rebuild; the access log must NOT be wiped.
    await runCommand(cwd, ['index', '--rebuild']);
    const stats = JSON.parse((await runCommand(cwd, ['stats', '--json'])).stdout);
    expect(stats.totalReads).toBe(1);
  });
});
