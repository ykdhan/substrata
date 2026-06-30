import { symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureGitignore, upsertAgentsMd } from '../src/index';
import { makeTempDir, removeDir } from './helpers';

describe('setup writers refuse symlinked targets', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeTempDir();
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  it('ensureGitignore skips when .gitignore is a symlink', () => {
    const victim = path.join(cwd, 'victim.txt');
    writeFileSync(victim, 'precious\n', 'utf8');
    symlinkSync(victim, path.join(cwd, '.gitignore'));

    const result = ensureGitignore(cwd);
    expect(result.action).toBe('skip');
    expect(result.description).toMatch(/symlink/);
  });

  it('upsertAgentsMd skips when AGENTS.md is a symlink', () => {
    const victim = path.join(cwd, 'victim.md');
    writeFileSync(victim, 'precious\n', 'utf8');
    symlinkSync(victim, path.join(cwd, 'AGENTS.md'));

    const result = upsertAgentsMd(cwd);
    expect(result.action).toBe('skip');
    expect(result.description).toMatch(/symlink/);
  });
});
