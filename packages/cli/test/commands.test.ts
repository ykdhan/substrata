import { listFootprints } from '@substrata/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTempRepo, removeDir, runCommand } from './helpers';

let cwd: string;

async function seedFootprint(title: string, extra: string[] = []): Promise<void> {
  await runCommand(cwd, ['add', '--title', title, '--actor', 'claude-code', ...extra]);
}

beforeEach(async () => {
  cwd = await makeTempRepo();
  await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);
});

afterEach(async () => {
  await removeDir(cwd);
});

describe('list', () => {
  it('lists footprints and filters by tag', async () => {
    await seedFootprint('First', ['--tag', 'alpha']);
    await seedFootprint('Second', ['--tag', 'beta']);

    const all = await runCommand(cwd, ['list', '--json']);
    expect(JSON.parse(all.stdout).length).toBe(2);

    const alpha = await runCommand(cwd, ['list', '--tag', 'alpha', '--json']);
    const parsed = JSON.parse(alpha.stdout);
    expect(parsed.length).toBe(1);
    expect(parsed[0].title).toBe('First');
  });
});

describe('show', () => {
  it('prints a footprint and supports --json / --path', async () => {
    await seedFootprint('Showable', ['--purpose', 'demo purpose']);
    const [fp] = await listFootprints(cwd);
    const id = fp!.frontmatter.id;

    const human = await runCommand(cwd, ['show', id]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain('Showable');

    const json = await runCommand(cwd, ['show', id, '--json']);
    expect(JSON.parse(json.stdout).id).toBe(id);

    const p = await runCommand(cwd, ['show', id, '--path']);
    expect(p.stdout.trim()).toBe(fp!.filePath);
  });

  it('exits non-zero for a missing id', async () => {
    const result = await runCommand(cwd, ['show', 'fp_does_not_exist']);
    expect(result.code).not.toBe(0);
  });
});

describe('doctor', () => {
  it('passes on a freshly inited repo (exit 0)', async () => {
    const result = await runCommand(cwd, ['doctor']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('.substrata exists');
    expect(result.stdout).toContain('config valid');
  });
});

describe('supersede', () => {
  it('marks the old footprint superseded', async () => {
    await seedFootprint('Old decision');
    await seedFootprint('New decision');
    const footprints = await listFootprints(cwd);
    // listFootprints is sorted created_at desc; both share a date so order may vary.
    const oldId = footprints.find((f) => f.title === 'Old decision')!.frontmatter.id;
    const newId = footprints.find((f) => f.title === 'New decision')!.frontmatter.id;

    const result = await runCommand(cwd, ['supersede', oldId, '--by', newId]);
    expect(result.code).toBe(0);

    const after = await listFootprints(cwd);
    const oldFp = after.find((f) => f.frontmatter.id === oldId)!;
    expect(oldFp.frontmatter.status).toBe('superseded');
    expect(oldFp.frontmatter.related?.superseded_by).toContain(newId);
  });
});

describe('index', () => {
  it('builds the index', async () => {
    const result = await runCommand(cwd, ['index', '--rebuild']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Index built');
  });
});
