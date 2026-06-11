import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  NotFoundError,
  parseFootprintFile,
  supersedeFootprint,
  writeFootprint,
} from '../src/index';
import { makeInitedProject, removeDir } from './helpers';

describe('supersedeFootprint', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeInitedProject();
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  it('edits frontmatter on both files and preserves bodies', async () => {
    const oldFp = await writeFootprint({
      cwd,
      title: 'Old decision',
      actor: 'a',
      purpose: 'Original purpose.',
      decisions: ['Original decision.'],
    });
    const newFp = await writeFootprint({
      cwd,
      title: 'New decision',
      actor: 'a',
      purpose: 'Replacement purpose.',
    });

    const oldBodyBefore = (await parseFootprintFile(oldFp.filePath)).body;
    const newBodyBefore = (await parseFootprintFile(newFp.filePath)).body;

    await supersedeFootprint(cwd, oldFp.frontmatter.id, newFp.frontmatter.id);

    const oldAfter = await parseFootprintFile(oldFp.filePath);
    const newAfter = await parseFootprintFile(newFp.filePath);

    expect(oldAfter.frontmatter.status).toBe('superseded');
    expect(oldAfter.frontmatter.related?.superseded_by).toEqual([newFp.frontmatter.id]);
    expect(newAfter.frontmatter.related?.supersedes).toEqual([oldFp.frontmatter.id]);

    // bodies unchanged
    expect(oldAfter.body).toBe(oldBodyBefore);
    expect(newAfter.body).toBe(newBodyBefore);
  });

  it('does not duplicate ids on repeated supersede', async () => {
    const oldFp = await writeFootprint({ cwd, title: 'Old', actor: 'a' });
    const newFp = await writeFootprint({ cwd, title: 'New', actor: 'a' });
    await supersedeFootprint(cwd, oldFp.frontmatter.id, newFp.frontmatter.id);
    await supersedeFootprint(cwd, oldFp.frontmatter.id, newFp.frontmatter.id);
    const oldAfter = await parseFootprintFile(oldFp.filePath);
    expect(oldAfter.frontmatter.related?.superseded_by).toEqual([newFp.frontmatter.id]);
  });

  it('throws NotFoundError when an id is missing', async () => {
    const newFp = await writeFootprint({ cwd, title: 'New', actor: 'a' });
    await expect(
      supersedeFootprint(cwd, 'fp_does_not_exist', newFp.frontmatter.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('preserves the exact body bytes including section markdown', async () => {
    const oldFp = await writeFootprint({
      cwd,
      title: 'Detailed',
      actor: 'a',
      purpose: 'P',
      rejectedOptions: [{ option: 'Opt', reason: 'Reason text.' }],
      commandsRun: ['pnpm test'],
    });
    const newFp = await writeFootprint({ cwd, title: 'Repl', actor: 'a' });

    const rawBefore = await readFile(oldFp.filePath, 'utf8');
    const bodyBefore = rawBefore.slice(rawBefore.indexOf('\n---\n') + 5);

    await supersedeFootprint(cwd, oldFp.frontmatter.id, newFp.frontmatter.id);

    const rawAfter = await readFile(oldFp.filePath, 'utf8');
    const bodyAfter = rawAfter.slice(rawAfter.indexOf('\n---\n') + 5);
    expect(bodyAfter).toBe(bodyBefore);
  });
});
