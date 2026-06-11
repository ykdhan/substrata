import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureGitignore,
  GITIGNORE_LINES,
  installSecretHook,
  renderPlan,
  summarizePlan,
  upsertAgentsMd,
  writeShellEnv,
} from '../src/index';
import { makeTempDir, removeDir } from './helpers';

describe('ensureGitignore', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeTempDir();
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  it('dry-run returns intended change without writing', () => {
    const result = ensureGitignore(cwd, true);
    expect(result.action).toBe('create');
    expect(result.contents).toContain('.substrata/index/');
    expect(existsSync(path.join(cwd, '.gitignore'))).toBe(false);
  });

  it('creates the file with all lines', () => {
    ensureGitignore(cwd, false);
    const content = readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    for (const line of GITIGNORE_LINES) expect(content).toContain(line);
  });

  it('is idempotent: re-run adds no duplicate lines', () => {
    ensureGitignore(cwd, false);
    const second = ensureGitignore(cwd, false);
    expect(second.action).toBe('skip');
    const content = readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    for (const line of GITIGNORE_LINES) {
      expect(content.split(line).length - 1).toBe(1);
    }
  });

  it('appends only missing lines to an existing file', () => {
    writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n.substrata/index/\n', 'utf8');
    ensureGitignore(cwd, false);
    const content = readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    expect(content.split('.substrata/index/').length - 1).toBe(1);
    expect(content).toContain('.substrata/cache/');
    expect(content).toContain('node_modules/');
  });
});

describe('writeShellEnv', () => {
  let cwd: string;
  let rc: string;
  beforeEach(async () => {
    cwd = await makeTempDir();
    rc = path.join(cwd, '.zshrc');
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  it('dry-run does not write', () => {
    const result = writeShellEnv(rc, { actor: 'claude-code' }, true);
    expect(result.contents).toContain('SUBSTRATA_ACTOR');
    expect(existsSync(rc)).toBe(false);
  });

  it('writes a marker-delimited block', () => {
    writeShellEnv(rc, { actor: 'claude-code', model: 'claude-opus-4' }, false);
    const content = readFileSync(rc, 'utf8');
    expect(content).toContain('# >>> substrata >>>');
    expect(content).toContain('# <<< substrata <<<');
    expect(content).toContain('export SUBSTRATA_ACTOR="claude-code"');
    expect(content).toContain('export SUBSTRATA_MODEL="claude-opus-4"');
  });

  it('replaces the block in place on rerun (no duplication)', () => {
    writeFileSync(rc, '# user content\n', 'utf8');
    writeShellEnv(rc, { actor: 'a' }, false);
    writeShellEnv(rc, { actor: 'b' }, false);
    const content = readFileSync(rc, 'utf8');
    expect(content.split('# >>> substrata >>>').length - 1).toBe(1);
    expect(content).toContain('export SUBSTRATA_ACTOR="b"');
    expect(content).not.toContain('export SUBSTRATA_ACTOR="a"');
    expect(content).toContain('# user content');
  });
});

describe('upsertAgentsMd', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeTempDir();
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  it('dry-run returns contents without writing', () => {
    const result = upsertAgentsMd(cwd, true);
    expect(result.contents).toContain('## Substrata Rules');
    expect(existsSync(path.join(cwd, 'AGENTS.md'))).toBe(false);
  });

  it('creates AGENTS.md with the marked section', () => {
    upsertAgentsMd(cwd, false);
    const content = readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8');
    expect(content).toContain('<!-- substrata:start -->');
    expect(content).toContain('<!-- substrata:end -->');
    expect(content).toContain('## Substrata Rules');
  });

  it('replaces in place on rerun (no duplicate section)', () => {
    writeFileSync(path.join(cwd, 'AGENTS.md'), '# Project agents\n\nExisting.\n', 'utf8');
    upsertAgentsMd(cwd, false);
    const second = upsertAgentsMd(cwd, false);
    expect(second.action).toBe('skip');
    const content = readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8');
    expect(content.split('<!-- substrata:start -->').length - 1).toBe(1);
    expect(content).toContain('Existing.');
  });
});

describe('installSecretHook', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeTempDir();
    mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true });
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  it('dry-run does not write', () => {
    const result = installSecretHook(cwd, true);
    expect(result.contents).toContain('internal-scan-staged');
    expect(existsSync(path.join(cwd, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });

  it('creates a pre-commit hook', () => {
    installSecretHook(cwd, false);
    const content = readFileSync(path.join(cwd, '.git', 'hooks', 'pre-commit'), 'utf8');
    expect(content.startsWith('#!/bin/sh')).toBe(true);
    expect(content).toContain('substrata internal-scan-staged');
  });

  it('is idempotent and appends to an existing hook without duplication', () => {
    const hookPath = path.join(cwd, '.git', 'hooks', 'pre-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho existing\n', 'utf8');
    installSecretHook(cwd, false);
    const second = installSecretHook(cwd, false);
    expect(second.action).toBe('skip');
    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('echo existing');
    expect(content.split('>>> substrata pre-commit >>>').length - 1).toBe(1);
  });
});

describe('plan helpers', () => {
  it('renders and summarizes a plan', () => {
    const changes = [
      { path: 'a', action: 'create' as const, description: 'x' },
      { path: 'b', action: 'skip' as const, description: 'y' },
    ];
    expect(renderPlan(changes)).toContain('CREATE');
    expect(summarizePlan(changes)).toEqual({ create: 1, update: 0, skip: 1 });
  });
});
