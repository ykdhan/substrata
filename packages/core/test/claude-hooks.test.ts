import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installClaudeHooks } from '../src/index';
import { makeTempDir, removeDir } from './helpers';

function settingsPath(cwd: string): string {
  return path.join(cwd, '.claude', 'settings.json');
}

describe('installClaudeHooks', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeTempDir();
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  it('dry-run returns contents without writing', () => {
    const result = installClaudeHooks(cwd, true);
    expect(result.action).toBe('create');
    expect(result.contents).toContain('substrata-cli hook session-start');
    expect(existsSync(settingsPath(cwd))).toBe(false);
  });

  it('writes all four lifecycle events', () => {
    installClaudeHooks(cwd, false);
    const json = JSON.parse(readFileSync(settingsPath(cwd), 'utf8'));
    expect(Object.keys(json.hooks).sort()).toEqual([
      'SessionStart',
      'Stop',
      'SubagentStop',
      'UserPromptSubmit',
    ]);
    expect(json.hooks.UserPromptSubmit[0].hooks[0].command).toContain('hook prompt-submit');
    expect(json.hooks.SubagentStop[0].hooks[0].command).toContain('--subagent');
  });

  it('is idempotent: re-run reports skip and adds no duplicate', () => {
    installClaudeHooks(cwd, false);
    const second = installClaudeHooks(cwd, false);
    expect(second.action).toBe('skip');
    const json = JSON.parse(readFileSync(settingsPath(cwd), 'utf8'));
    expect(json.hooks.SessionStart.length).toBe(1);
  });

  it('preserves a user\'s existing hooks and settings', () => {
    mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(cwd),
      JSON.stringify({
        model: 'opus',
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }],
        },
      }),
      'utf8',
    );
    installClaudeHooks(cwd, false);
    const json = JSON.parse(readFileSync(settingsPath(cwd), 'utf8'));
    expect(json.model).toBe('opus');
    // The user's own SessionStart hook survives alongside ours.
    const cmds = json.hooks.SessionStart.map((g: { hooks: { command: string }[] }) => g.hooks[0].command);
    expect(cmds).toContain('echo hi');
    expect(cmds.some((c: string) => c.includes('hook session-start'))).toBe(true);
  });

  it('remove strips only Substrata entries', () => {
    mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(cwd),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
      }),
      'utf8',
    );
    installClaudeHooks(cwd, false);
    const removed = installClaudeHooks(cwd, false, { remove: true });
    expect(removed.action).toBe('update');
    const json = JSON.parse(readFileSync(settingsPath(cwd), 'utf8'));
    const cmds = json.hooks.SessionStart.map((g: { hooks: { command: string }[] }) => g.hooks[0].command);
    expect(cmds).toEqual(['echo hi']);
    // Events we introduced and that the user never had are gone entirely.
    expect(json.hooks.UserPromptSubmit).toBeUndefined();
  });

  it('remove on a clean file is a skip', () => {
    const result = installClaudeHooks(cwd, false, { remove: true });
    expect(result.action).toBe('skip');
  });
});
