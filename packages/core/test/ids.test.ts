import { describe, expect, it } from 'vitest';

import { buildFootprintFilename, generateFootprintId, randomSuffix, slugify } from '../src/index';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Improve Learner Search Performance')).toBe(
      'improve-learner-search-performance',
    );
  });

  it('collapses non-alphanumeric runs and trims', () => {
    expect(slugify('  Hello,   World!!  ')).toBe('hello-world');
  });

  it('strips diacritics', () => {
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu');
  });

  it('falls back to "untitled" for empty input', () => {
    expect(slugify('!!!')).toBe('untitled');
    expect(slugify('')).toBe('untitled');
  });
});

describe('randomSuffix', () => {
  it('produces a 6-char lowercase base32 string', () => {
    const s = randomSuffix();
    expect(s).toMatch(/^[a-z0-9]{6}$/);
    expect(s).not.toMatch(/[ilou]/);
  });

  it('respects custom length', () => {
    expect(randomSuffix(10)).toHaveLength(10);
  });

  it('is effectively unique across many draws', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(randomSuffix());
    expect(set.size).toBeGreaterThan(995);
  });
});

describe('generateFootprintId', () => {
  it('produces fp_<YYYYMMDD>_<slug>_<suffix> with underscores', () => {
    const date = new Date('2026-06-09T10:30:00Z');
    const id = generateFootprintId(date, 'learner-search-performance', 'k7m2qx');
    expect(id).toBe('fp_20260609_learner_search_performance_k7m2qx');
  });

  it('generates a random suffix when none provided', () => {
    const date = new Date('2026-06-09T00:00:00Z');
    const a = generateFootprintId(date, 'x');
    const b = generateFootprintId(date, 'x');
    expect(a).toMatch(/^fp_20260609_x_[a-z0-9]{6}$/);
    expect(a).not.toBe(b);
  });
});

describe('buildFootprintFilename', () => {
  it('builds YYYY/MM/YYYY-MM-DD-<slug>-<suffix>.md', () => {
    const date = new Date('2026-06-09T10:30:00Z');
    expect(buildFootprintFilename(date, 'learner-search', 'k7m2qx')).toBe(
      '2026/06/2026-06-09-learner-search-k7m2qx.md',
    );
  });
});
