import { rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndex } from '../src/indexer';
import { getRelatedToFile } from '../src/query';
import { addFootprint, makeTempRepo } from './fixture';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  await addFootprint(cwd, {
    title: 'Edit the user service',
    actor: 'a',
    filesTouched: ['src/services/user.ts'],
    tags: ['user'],
  });
  await addFootprint(cwd, {
    title: 'Edit the order service',
    actor: 'a',
    filesTouched: ['src/services/order.ts'],
    tags: ['order'],
  });
  await addFootprint(cwd, {
    title: 'Unrelated docs change',
    actor: 'a',
    filesTouched: ['docs/readme.md'],
    tags: ['docs'],
  });
  await buildIndex(cwd);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('getRelatedToFile neighbor expansion', () => {
  it('surfaces footprints touching sibling files in the same directory', async () => {
    const results = await getRelatedToFile('src/services/user.ts', { cwd });
    const titles = results.map((r) => r.title);
    // Exact hit:
    expect(titles).toContain('Edit the user service');
    // Neighbor (same dir, different file):
    expect(titles).toContain('Edit the order service');
    // Not a neighbor (different dir):
    expect(titles).not.toContain('Unrelated docs change');
  });

  it('ranks the exact file hit above the neighbor', async () => {
    const results = await getRelatedToFile('src/services/user.ts', { cwd });
    const exactIdx = results.findIndex((r) => r.title === 'Edit the user service');
    const neighborIdx = results.findIndex((r) => r.title === 'Edit the order service');
    expect(exactIdx).toBeGreaterThanOrEqual(0);
    expect(neighborIdx).toBeGreaterThan(exactIdx);
  });

  it('includeNeighbors:false restores exact-only behavior', async () => {
    const results = await getRelatedToFile('src/services/user.ts', {
      cwd,
      includeNeighbors: false,
    });
    const titles = results.map((r) => r.title);
    expect(titles).toContain('Edit the user service');
    expect(titles).not.toContain('Edit the order service');
  });

  it('honors the tags hard-filter for exact and neighbor hits', async () => {
    // Only the `user`-tagged footprint may pass; the `order` neighbor is filtered.
    const results = await getRelatedToFile('src/services/user.ts', { cwd, tags: ['user'] });
    const titles = results.map((r) => r.title);
    expect(titles).toContain('Edit the user service');
    expect(titles).not.toContain('Edit the order service');
  });
});
