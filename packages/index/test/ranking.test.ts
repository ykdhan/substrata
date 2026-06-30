import { describe, expect, it } from 'vitest';

import {
  FILES_OVERLAP_BOOST,
  RECENCY_DECAY_DAYS,
  STATUS_PENALTIES,
  filesOverlap,
  normalizeBm25,
  recencyBoost,
  recencyDecay,
  score,
  statusPenalty,
} from '../src/ranking';

const NOW = Date.parse('2026-06-11T00:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const isoDaysAgo = (days: number) => new Date(NOW - days * MS_PER_DAY).toISOString();

describe('normalizeBm25', () => {
  it('flips negative-is-better bm25 into positive relevance', () => {
    expect(normalizeBm25(-3)).toBe(3);
    expect(normalizeBm25(-1)).toBeLessThan(normalizeBm25(-3));
  });
});

describe('recencyDecay', () => {
  it('is 1 for now and 0 for missing/old timestamps', () => {
    expect(recencyDecay(isoDaysAgo(0), NOW)).toBeCloseTo(1, 5);
    expect(recencyDecay(undefined, NOW)).toBe(0);
    expect(recencyDecay(isoDaysAgo(RECENCY_DECAY_DAYS + 30), NOW)).toBe(0);
  });

  it('decays linearly over the window', () => {
    expect(recencyDecay(isoDaysAgo(RECENCY_DECAY_DAYS / 2), NOW)).toBeCloseTo(0.5, 5);
  });
});

describe('recencyBoost', () => {
  it('halves the boost for architecture_decision', () => {
    const normal = recencyBoost(isoDaysAgo(0), 'implementation', NOW);
    const arch = recencyBoost(isoDaysAgo(0), 'architecture_decision', NOW);
    expect(normal).toBeCloseTo(1.15, 5);
    expect(arch).toBeCloseTo(1.075, 5);
  });
});

describe('filesOverlap', () => {
  it('detects case-insensitive overlap', () => {
    expect(filesOverlap(['api/Learners.ts'], ['api/learners.ts'])).toBe(true);
    expect(filesOverlap(['a.ts'], ['b.ts'])).toBe(false);
    expect(filesOverlap([], ['a.ts'])).toBe(false);
  });
});

describe('statusPenalty', () => {
  it('applies the configured multipliers', () => {
    expect(statusPenalty('superseded')).toBe(STATUS_PENALTIES.superseded);
    expect(statusPenalty('deprecated')).toBe(STATUS_PENALTIES.deprecated);
    expect(statusPenalty('draft')).toBe(0.5);
    expect(statusPenalty('completed')).toBe(1);
    expect(statusPenalty(null)).toBe(1);
  });
});

describe('score', () => {
  it('applies file-overlap boost', () => {
    const base = score({ bm25: -2, docFiles: ['x.ts'], queryFiles: [] }, NOW);
    const boosted = score({ bm25: -2, docFiles: ['x.ts'], queryFiles: ['x.ts'] }, NOW);
    expect(boosted).toBeCloseTo(base * FILES_OVERLAP_BOOST, 5);
  });

  it('demotes superseded below an equivalent completed doc', () => {
    const completed = score({ bm25: -2, status: 'completed', docFiles: [], queryFiles: [] }, NOW);
    const superseded = score({ bm25: -2, status: 'superseded', docFiles: [], queryFiles: [] }, NOW);
    expect(superseded).toBeLessThan(completed);
  });
});
