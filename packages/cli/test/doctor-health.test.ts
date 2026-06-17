import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTempRepo, removeDir, runCommand } from './helpers';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--no-claude-hooks']);
});

afterEach(async () => {
  await removeDir(cwd);
});

describe('doctor health warnings', () => {
  it('warns when hooks are not installed and stays exit 0', async () => {
    const res = await runCommand(cwd, ['doctor']);
    expect(res.code).toBe(0);
    expect(res.stdout + res.stderr).toContain('Claude Code hooks not installed');
  });

  it('reports hooks installed after `hook claude`', async () => {
    await runCommand(cwd, ['hook', 'claude']);
    const res = await runCommand(cwd, ['doctor']);
    expect(res.stdout + res.stderr).toContain('Claude Code hooks installed');
  });

  it('warns on a 0:1 read:write ratio, then reports a healthy ratio after reads', async () => {
    await runCommand(cwd, ['add', '--title', 'Some decision', '--actor', 'a']);
    const cold = await runCommand(cwd, ['doctor']);
    expect(cold.stdout + cold.stderr).toContain('read:write ratio is 0:1');

    await runCommand(cwd, ['search', 'decision']);
    await runCommand(cwd, ['context', 'some decision']);
    const warm = await runCommand(cwd, ['doctor']);
    expect(warm.stdout + warm.stderr).toContain('read:write ratio 2.00:1');
    expect(warm.stdout + warm.stderr).not.toContain('ratio is 0:1');
  });
});
