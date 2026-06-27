import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTempRepo, removeDir, runCommand, stripAnsi } from './helpers';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
});

afterEach(async () => {
  await removeDir(cwd);
});

describe('mcp print-config', () => {
  it('prints generic mcpServers JSON to stdout by default', async () => {
    const result = await runCommand(cwd, ['mcp', 'print-config']);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.mcpServers.substrata.command).toBe('npx');
    expect(parsed.mcpServers.substrata.args).toEqual(['-y', 'substrata-cli', 'mcp']);
  });

  it('prints codex TOML with --client codex', async () => {
    const result = await runCommand(cwd, ['mcp', 'print-config', '--client', 'codex']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('[mcp_servers.substrata]');
  });

  it('rejects an unknown client', async () => {
    const result = await runCommand(cwd, ['mcp', 'print-config', '--client', 'nope']);
    expect(result.code).not.toBe(0);
  });
});

describe('mcp install', () => {
  it('registers the server into .mcp.json with --client claude', async () => {
    const result = await runCommand(cwd, ['mcp', 'install', '--client', 'claude']);
    expect(result.code).toBe(0);

    const file = path.join(cwd, '.mcp.json');
    expect(existsSync(file)).toBe(true);
    const json = JSON.parse(readFileSync(file, 'utf8'));
    expect(json.mcpServers.substrata.command).toBe('npx');
  });

  it('--dry does not write the config file', async () => {
    const result = await runCommand(cwd, ['mcp', 'install', '--client', 'claude', '--dry']);
    expect(result.code).toBe(0);
    expect(stripAnsi(result.stdout)).toContain('would');
    expect(existsSync(path.join(cwd, '.mcp.json'))).toBe(false);
  });

  it('rejects an unknown client', async () => {
    const result = await runCommand(cwd, ['mcp', 'install', '--client', 'nope']);
    expect(result.code).not.toBe(0);
  });
});
