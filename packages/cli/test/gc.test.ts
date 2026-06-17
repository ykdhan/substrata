import { listFootprints } from '@substrata/core';
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

describe('gc', () => {
  it('reports duplicate clusters by normalized title', async () => {
    await runCommand(cwd, ['add', '--title', 'Adopt Cursor Pagination', '--actor', 'a']);
    await runCommand(cwd, ['add', '--title', 'adopt cursor pagination', '--actor', 'a']);
    await runCommand(cwd, ['add', '--title', 'Something else', '--actor', 'a']);

    const res = await runCommand(cwd, ['gc', '--json']);
    expect(res.code).toBe(0);
    const report = JSON.parse(res.stdout);
    expect(report.duplicateClusters.length).toBe(1);
    expect(report.duplicateClusters[0].ids.length).toBe(2);
  });

  it('--auto-supersede links older duplicates to the newest', async () => {
    await runCommand(cwd, ['add', '--title', 'Dup title', '--actor', 'a']);
    await runCommand(cwd, ['add', '--title', 'Dup title', '--actor', 'a']);

    const res = await runCommand(cwd, ['gc', '--auto-supersede', '--json']);
    const report = JSON.parse(res.stdout);
    expect(report.superseded.length).toBe(1);

    const after = await listFootprints(cwd);
    const superseded = after.filter((fp) => fp.frontmatter.status === 'superseded');
    expect(superseded.length).toBe(1);
    // Running again finds no active duplicates left.
    const second = JSON.parse((await runCommand(cwd, ['gc', '--json'])).stdout);
    expect(second.duplicateClusters.length).toBe(0);
  });

  it('reports a tidy repo cleanly', async () => {
    await runCommand(cwd, ['add', '--title', 'Only one', '--actor', 'a']);
    const res = await runCommand(cwd, ['gc']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('tidy');
  });
});
