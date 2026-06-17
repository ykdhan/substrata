import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadConfig } from '@substrata/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emitContext, emitStopDecision } from '../src/hooks/claude-code';
import { buildHookContext, recentDigest } from '../src/hooks/context';
import { makeTempRepo, removeDir, runCommand } from './helpers';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--no-claude-hooks']);
});

afterEach(async () => {
  await removeDir(cwd);
});

describe('hook claude (settings.json installer)', () => {
  it('installs and is idempotent, then removes', async () => {
    const install = await runCommand(cwd, ['hook', 'claude']);
    expect(install.code).toBe(0);
    const file = path.join(cwd, '.claude', 'settings.json');
    expect(readFileSync(file, 'utf8')).toContain('hook prompt-submit');

    const again = await runCommand(cwd, ['hook', 'claude']);
    expect(again.stdout).toContain('already installed');

    const remove = await runCommand(cwd, ['hook', 'claude', '--remove']);
    expect(remove.code).toBe(0);
    const json = JSON.parse(readFileSync(file, 'utf8'));
    expect(json.hooks?.UserPromptSubmit).toBeUndefined();
  });
});

describe('recentDigest', () => {
  it('returns null with no footprints and a digest after seeding', async () => {
    expect(await recentDigest(cwd, await loadConfig(cwd))).toBeNull();

    await runCommand(cwd, [
      'add',
      '--title',
      'Use cursor pagination',
      '--actor',
      'claude-code',
      '--decision',
      'Adopt keyset pagination over OFFSET',
    ]);

    const digest = await recentDigest(cwd, await loadConfig(cwd));
    expect(digest).toContain('Recent Substrata project memory');
    expect(digest).toContain('Use cursor pagination');
    expect(digest).toContain('keyset pagination');
  });

  it('excludes superseded footprints', async () => {
    await runCommand(cwd, ['add', '--title', 'Old way', '--actor', 'a']);
    await runCommand(cwd, ['add', '--title', 'New way', '--actor', 'a']);
    const { listFootprints } = await import('@substrata/core');
    const fps = await listFootprints(cwd);
    const oldId = fps.find((f) => f.title === 'Old way')!.frontmatter.id;
    const newId = fps.find((f) => f.title === 'New way')!.frontmatter.id;
    await runCommand(cwd, ['supersede', oldId, '--by', newId]);

    const digest = await recentDigest(cwd, await loadConfig(cwd));
    expect(digest).not.toContain('Old way');
    expect(digest).toContain('New way');
  });
});

describe('buildHookContext', () => {
  it('returns null for an empty query and a hit for a relevant prompt', async () => {
    await runCommand(cwd, [
      'add',
      '--title',
      'Stripe webhook retry handling',
      '--actor',
      'claude-code',
      '--decision',
      'Use idempotency keys for webhook replays',
    ]);
    const config = await loadConfig(cwd);

    expect(await buildHookContext(cwd, config, { query: '   ' })).toBeNull();

    const hit = await buildHookContext(cwd, config, { query: 'how do we handle stripe webhooks' });
    expect(hit).toContain('Substrata context');
    expect(hit).toContain('idempotency keys');
  });

  it('respects a high min_score by injecting nothing', async () => {
    await runCommand(cwd, ['add', '--title', 'Some note', '--actor', 'a']);
    const config = await loadConfig(cwd);
    const strict = { ...config, hooks: { ...config.hooks, min_score: 1e9 } };
    expect(await buildHookContext(cwd, strict, { query: 'some note' })).toBeNull();
  });
});

describe('emit helpers', () => {
  it('emitContext writes hookSpecificOutput and skips empty text', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      expect(emitContext('UserPromptSubmit', '   ')).toBeNull();
      const json = emitContext('UserPromptSubmit', 'hello');
      expect(json).not.toBeNull();
      const parsed = JSON.parse(json!);
      expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
      expect(parsed.hookSpecificOutput.additionalContext).toBe('hello');
    } finally {
      write.mockRestore();
    }
  });

  it('emitStopDecision blocks with a reason', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      const parsed = JSON.parse(emitStopDecision('leave a footprint'));
      expect(parsed.decision).toBe('block');
      expect(parsed.reason).toContain('footprint');
    } finally {
      write.mockRestore();
    }
  });
});
