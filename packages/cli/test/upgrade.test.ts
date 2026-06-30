import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTempRepo, removeDir, runCommand } from './helpers';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
});

afterEach(async () => {
  await removeDir(cwd);
});

describe('upgrade', () => {
  it('fails politely when the repo was never initialized', async () => {
    const result = await runCommand(cwd, ['upgrade']);
    expect(result.code).not.toBe(0);
  });

  it('refreshes a stale AGENTS.md section to the current template', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);

    // Simulate a section written by an older CLI version.
    const agentsPath = path.join(cwd, 'AGENTS.md');
    writeFileSync(
      agentsPath,
      [
        '# My project',
        '',
        '<!-- substrata:start -->',
        '## Substrata Rules',
        '',
        'Run `substrata context "<task description>"`.',
        '<!-- substrata:end -->',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await runCommand(cwd, ['upgrade']);
    expect(result.code).toBe(0);

    const agents = readFileSync(agentsPath, 'utf8');
    expect(agents).toContain('# My project');
    expect(agents).toContain('npx -y substrata-cli context');
    expect(agents).not.toContain('Run `substrata context');
    // Markers still present exactly once.
    expect(agents.split('<!-- substrata:start -->').length).toBe(2);
  });

  it('preserves shared mode: does not re-ignore the committed index DB', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--sharing', 'shared']);

    const result = await runCommand(cwd, ['upgrade', '--no-index']);
    expect(result.code).toBe(0);

    const lines = readFileSync(path.join(cwd, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim());
    // The committed DB must stay committable after upgrade.
    expect(lines).not.toContain('.substrata/index/');
    expect(lines).toContain('.substrata/index/*.sqlite-journal');
    // Telemetry stays private.
    expect(lines).toContain('.substrata/local/');
    // .gitattributes is (re)asserted in shared mode.
    expect(readFileSync(path.join(cwd, '.gitattributes'), 'utf8')).toContain(
      '.substrata/index/*.sqlite binary',
    );
  });

  it('does not add an AGENTS.md section where none exists', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--no-agents-md']);
    const result = await runCommand(cwd, ['upgrade']);
    expect(result.code).toBe(0);
    expect(() => readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8')).toThrow();
  });

  it('re-merges a drifted existing MCP registration but never adds one', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);

    // Drifted entry from an older version.
    writeFileSync(
      path.join(cwd, '.mcp.json'),
      JSON.stringify(
        { mcpServers: { substrata: { command: 'npx', args: ['-y', '@substrata/cli', 'mcp'] } } },
        null,
        2,
      ),
      'utf8',
    );
    // Cursor config exists but has no substrata entry — must stay untouched.
    mkdirSync(path.join(cwd, '.cursor'), { recursive: true });
    writeFileSync(path.join(cwd, '.cursor', 'mcp.json'), '{"mcpServers":{}}', 'utf8');

    const result = await runCommand(cwd, ['upgrade']);
    expect(result.code).toBe(0);

    const mcp = JSON.parse(readFileSync(path.join(cwd, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.substrata.args).toEqual(['-y', 'substrata-cli', 'mcp']);

    const cursor = JSON.parse(readFileSync(path.join(cwd, '.cursor', 'mcp.json'), 'utf8'));
    expect(cursor.mcpServers.substrata).toBeUndefined();
  });
});
