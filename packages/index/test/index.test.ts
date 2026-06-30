import { existsSync } from 'node:fs';
import { rm, utimes } from 'node:fs/promises';

import { indexPath, listFootprints } from '@substrata/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndex } from '../src/indexer';
import { getIndexStatus } from '../src/freshness';
import { getRelatedToFile, search } from '../src/query';

import { addFootprint, makeTempRepo, seedRepo } from './fixture';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  await seedRepo(cwd);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('buildIndex', () => {
  it('creates the SQLite index file', async () => {
    expect(existsSync(indexPath(cwd))).toBe(false);
    await buildIndex(cwd);
    expect(existsSync(indexPath(cwd))).toBe(true);
  });
});

describe('search', () => {
  it('returns relevant ranked results for a term', async () => {
    await buildIndex(cwd);
    const results = await search('learner search pagination', { cwd });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.title).toContain('learner search performance');
    expect(results[0]!.snippet.length).toBeGreaterThan(0);
  });

  it('applies the file filter', async () => {
    await buildIndex(cwd);
    const results = await search('learner', { cwd, files: ['api/learners.ts'] });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.filesTouched).toContain('api/learners.ts');
    }
  });

  it('applies the tag filter', async () => {
    await buildIndex(cwd);
    const results = await search('learner', { cwd, tags: ['redis'] });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.tags).toContain('redis');
    }
  });

  it('excludeSuperseded drops superseded and deprecated docs', async () => {
    await buildIndex(cwd);
    const withSuperseded = await search('redis', { cwd });
    const withoutSuperseded = await search('redis', { cwd, excludeSuperseded: true });
    expect(withSuperseded.some((r) => r.status === 'superseded')).toBe(true);
    expect(withoutSuperseded.some((r) => r.status === 'superseded')).toBe(false);
  });

  it('demotes a superseded doc below a fresh completed doc for the same term', async () => {
    await buildIndex(cwd);
    const results = await search('redis learner', { cwd });
    const completedIdx = results.findIndex((r) => r.status === 'completed');
    const supersededIdx = results.findIndex((r) => r.status === 'superseded');
    expect(completedIdx).toBeGreaterThanOrEqual(0);
    expect(supersededIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeLessThan(supersededIdx);
  });

  it('does not throw on a punctuation-heavy query', async () => {
    await buildIndex(cwd);
    const results = await search('why did we avoid Redis?!', { cwd });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('getRelatedToFile', () => {
  it('finds footprints touching a file', async () => {
    await buildIndex(cwd);
    const results = await getRelatedToFile('api/learners.ts', { cwd });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.filesTouched.includes('api/learners.ts'))).toBe(true);
  });
});

describe('getIndexStatus', () => {
  it('is missing before build, fresh after', async () => {
    expect(await getIndexStatus(cwd)).toEqual({ state: 'missing' });
    await buildIndex(cwd);
    expect(await getIndexStatus(cwd)).toEqual({ state: 'fresh' });
  });

  it('is stale (mtime) after touching a footprint file', async () => {
    await buildIndex(cwd);
    const footprints = await listFootprints(cwd);
    const target = footprints[0]!;
    const future = new Date(Date.now() + 60_000);
    await utimes(target.filePath, future, future);
    expect(await getIndexStatus(cwd)).toEqual({ state: 'stale', reason: 'mtime' });
  });

  it('is stale (count) after adding a footprint', async () => {
    await buildIndex(cwd);
    await addFootprint(cwd, {
      title: 'A brand new footprint',
      purpose: 'Adds a source file so the count changes.',
      actor: 'claude-code',
      status: 'completed',
    });
    expect(await getIndexStatus(cwd)).toEqual({ state: 'stale', reason: 'count' });
  });
});
