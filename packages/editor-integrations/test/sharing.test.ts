import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureCliDependency,
  ensureGitattributes,
  ensureGitignore,
  gitignoreLinesFor,
} from '../src/index';
import { makeTempDir, removeDir } from './helpers';

let cwd: string;
beforeEach(async () => {
  cwd = await makeTempDir();
});
afterEach(async () => {
  await removeDir(cwd);
});

const readGitignore = () => readFileSync(path.join(cwd, '.gitignore'), 'utf8');

describe('gitignore sharing modes', () => {
  it('local mode ignores the whole index dir + always-local telemetry dir', () => {
    ensureGitignore(cwd, false, { sharing: 'local' });
    const c = readGitignore();
    expect(c).toContain('.substrata/index/');
    expect(c).toContain('.substrata/local/');
    expect(c).toContain('.substrata/cache/');
  });

  it('shared mode keeps the committed *.sqlite but ignores journals + local telemetry', () => {
    ensureGitignore(cwd, false, { sharing: 'shared' });
    const c = readGitignore();
    // The DB files are NOT blanket-ignored...
    const lines = c.split('\n').map((l) => l.trim());
    expect(lines).not.toContain('.substrata/index/');
    expect(c).toContain('.substrata/index/*.sqlite-journal');
    // ...but transient + private data still is.
    expect(c).toContain('.substrata/local/'); // telemetry stays private even when shared
    expect(c).toContain('.substrata/cache/');
  });

  it('switching local -> shared removes the stale blanket index ignore', () => {
    ensureGitignore(cwd, false, { sharing: 'local' });
    expect(
      readGitignore()
        .split('\n')
        .map((l) => l.trim()),
    ).toContain('.substrata/index/');

    const switched = ensureGitignore(cwd, false, { sharing: 'shared' });
    expect(switched.action).toBe('update');
    const lines = readGitignore()
      .split('\n')
      .map((l) => l.trim());
    expect(lines).not.toContain('.substrata/index/');
    expect(lines).toContain('.substrata/index/*.sqlite-wal');
  });

  it('preserves unrelated user lines across a mode switch', () => {
    writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\ndist/\n', 'utf8');
    ensureGitignore(cwd, false, { sharing: 'shared' });
    const c = readGitignore();
    expect(c).toContain('node_modules/');
    expect(c).toContain('dist/');
  });

  it('telemetry path is gitignored in BOTH modes (privacy)', () => {
    expect(gitignoreLinesFor('local')).toContain('.substrata/local/');
    expect(gitignoreLinesFor('shared')).toContain('.substrata/local/');
  });
});

describe('ensureGitattributes', () => {
  it('marks the shared index DBs as binary, idempotently', () => {
    const first = ensureGitattributes(cwd, false);
    expect(first.action).toBe('create');
    const c = readFileSync(path.join(cwd, '.gitattributes'), 'utf8');
    expect(c).toContain('.substrata/index/*.sqlite binary');

    const second = ensureGitattributes(cwd, false);
    expect(second.action).toBe('skip');
  });

  it('appends to an existing .gitattributes without clobbering it', () => {
    writeFileSync(path.join(cwd, '.gitattributes'), '*.png binary\n', 'utf8');
    ensureGitattributes(cwd, false);
    const c = readFileSync(path.join(cwd, '.gitattributes'), 'utf8');
    expect(c).toContain('*.png binary');
    expect(c).toContain('.substrata/index/*.sqlite binary');
  });
});

describe('ensureCliDependency', () => {
  const writePkg = (obj: Record<string, unknown>) =>
    writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify(obj, null, 2)}\n`, 'utf8');

  it('adds substrata-cli to devDependencies when absent', () => {
    writePkg({ name: 'consumer', version: '1.0.0' });
    const result = ensureCliDependency(cwd, '0.2.0', false);
    expect(result.action).toBe('update');
    const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['substrata-cli']).toBe('^0.2.0');
  });

  it('skips when already a dependency (never overwrites a user pin)', () => {
    writePkg({ name: 'consumer', dependencies: { 'substrata-cli': '0.1.0' } });
    const result = ensureCliDependency(cwd, '0.2.0', false);
    expect(result.action).toBe('skip');
    const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    expect(pkg.dependencies['substrata-cli']).toBe('0.1.0');
  });

  it('skips when already a devDependency', () => {
    writePkg({ name: 'consumer', devDependencies: { 'substrata-cli': '^0.2.0' } });
    expect(ensureCliDependency(cwd, '0.2.0', false).action).toBe('skip');
  });

  it('skips when there is no package.json', () => {
    const result = ensureCliDependency(cwd, '0.2.0', false);
    expect(result.action).toBe('skip');
    expect(result.description).toMatch(/no package\.json/);
  });

  it('dry-run does not write', () => {
    writePkg({ name: 'consumer' });
    const before = readFileSync(path.join(cwd, 'package.json'), 'utf8');
    ensureCliDependency(cwd, '0.2.0', true);
    expect(readFileSync(path.join(cwd, 'package.json'), 'utf8')).toBe(before);
  });
});
