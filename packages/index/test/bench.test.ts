import { rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runBenchmark } from '../src/bench';
import { buildGraph } from '../src/graph/indexer';
import { buildIndex } from '../src/indexer';

import { makeTempRepo, seedRepo } from './fixture';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  await seedRepo(cwd);
  await buildIndex(cwd);
  await buildGraph(cwd);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('runBenchmark', () => {
  it('substrata retrieves far fewer tokens than reading the whole corpus', async () => {
    const result = await runBenchmark(cwd, {
      queries: ['learner search performance', 'billing event sourcing'],
    });

    expect(result.corpusDocs).toBeGreaterThanOrEqual(5);
    expect(result.baselineTokens).toBeGreaterThan(0);
    // The whole point: the rendered context is a strict subset of the corpus.
    expect(result.substrataTokens).toBeLessThan(result.baselineTokens);
    expect(result.reductionPct).toBeGreaterThan(0);

    // Per-query invariants.
    for (const q of result.perQuery) {
      expect(q.substrataTokens).toBeLessThanOrEqual(q.baselineTokens);
      expect(q.baselineMs).toBeGreaterThanOrEqual(0);
      expect(q.substrataMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('honors the token budget (smaller maxTokens never yields more tokens)', async () => {
    const tight = await runBenchmark(cwd, { queries: ['learner search'], maxTokens: 120 });
    const loose = await runBenchmark(cwd, { queries: ['learner search'], maxTokens: 1600 });
    expect(tight.substrataTokens).toBeLessThanOrEqual(loose.substrataTokens);
  });
});
