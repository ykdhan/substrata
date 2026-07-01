import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installIndexHook } from '../src/index';
import { makeTempDir, removeDir } from './helpers';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempDir();
  mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true });
});

afterEach(async () => {
  await removeDir(cwd);
});

const hookPath = (name: string) => path.join(cwd, '.git', 'hooks', name);
const read = (name: string) => readFileSync(hookPath(name), 'utf8');

describe('installIndexHook', () => {
  it('creates post-merge and post-checkout hooks that refresh the index', () => {
    const results = installIndexHook(cwd, false);
    expect(results.map((r) => r.action)).toEqual(['create', 'create']);

    for (const name of ['post-merge', 'post-checkout']) {
      const content = read(name);
      expect(content.startsWith('#!/bin/sh')).toBe(true);
      expect(content).toContain('substrata-cli internal-refresh-index');
      expect(content).toContain('.substrata/config.yml');
    }
    // post-checkout only fires on a branch checkout (flag == 1).
    expect(read('post-checkout')).toContain('"$3" = "1"');
  });

  it('is idempotent: re-run skips both hooks', () => {
    installIndexHook(cwd, false);
    const second = installIndexHook(cwd, false);
    expect(second.every((r) => r.action === 'skip')).toBe(true);
    // No duplicate guard blocks.
    expect(read('post-merge').split('>>> substrata post-merge >>>').length).toBe(2);
  });

  it('appends to an existing hook without clobbering it', () => {
    writeFileSync(hookPath('post-merge'), '#!/bin/sh\necho existing\n', 'utf8');
    installIndexHook(cwd, false);
    const content = read('post-merge');
    expect(content).toContain('echo existing');
    expect(content).toContain('internal-refresh-index');
  });

  it('refuses a symlinked hook', () => {
    const victim = path.join(cwd, 'victim.sh');
    writeFileSync(victim, 'echo precious\n', 'utf8');
    symlinkSync(victim, hookPath('post-merge'));
    const results = installIndexHook(cwd, false);
    const merge = results.find((r) => r.path.endsWith('post-merge'))!;
    expect(merge.action).toBe('skip');
    expect(merge.description).toMatch(/symlink/);
  });

  it('dry-run writes nothing', () => {
    const results = installIndexHook(cwd, true);
    expect(results.every((r) => r.action === 'create')).toBe(true);
    expect(existsSync(hookPath('post-merge'))).toBe(false);
    expect(existsSync(hookPath('post-checkout'))).toBe(false);
  });
});
