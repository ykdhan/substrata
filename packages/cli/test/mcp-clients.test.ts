import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { codexClient } from '../src/mcp-clients/codex';
import { geminiClient } from '../src/mcp-clients/gemini';
import { mergeMcpJson, removeMcpJson } from '../src/mcp-clients/json-config';
import { renderMcpConfig } from '../src/mcp-clients/print-config';
import { getMcpClient, MCP_CLIENTS, SUBSTRATA_MCP_SPEC } from '../src/mcp-clients/registry';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'substrata-mcp-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('mergeMcpJson', () => {
  it('creates .mcp.json with the substrata server', () => {
    const file = path.join(cwd, '.mcp.json');
    const result = mergeMcpJson(file, SUBSTRATA_MCP_SPEC);
    expect(result.action).toBe('create');

    const json = JSON.parse(readFileSync(file, 'utf8'));
    expect(json.mcpServers.substrata.command).toBe('npx');
    expect(json.mcpServers.substrata.args).toEqual(['-y', 'substrata-cli', 'mcp']);
  });

  it('is idempotent: a second merge skips', () => {
    const file = path.join(cwd, '.mcp.json');
    mergeMcpJson(file, SUBSTRATA_MCP_SPEC);
    const second = mergeMcpJson(file, SUBSTRATA_MCP_SPEC);
    expect(second.action).toBe('skip');

    const json = JSON.parse(readFileSync(file, 'utf8'));
    expect(Object.keys(json.mcpServers)).toEqual(['substrata']);
  });

  it('preserves other servers and unrelated keys', async () => {
    const file = path.join(cwd, '.mcp.json');
    await writeFile(
      file,
      JSON.stringify(
        { mcpServers: { other: { command: 'foo', args: [] } }, custom: true },
        null,
        2,
      ),
      'utf8',
    );

    mergeMcpJson(file, SUBSTRATA_MCP_SPEC);
    const json = JSON.parse(readFileSync(file, 'utf8'));
    expect(json.custom).toBe(true);
    expect(json.mcpServers.other.command).toBe('foo');
    expect(json.mcpServers.substrata.command).toBe('npx');
  });

  it('dry run does not write', () => {
    const file = path.join(cwd, '.cursor', 'mcp.json');
    const result = mergeMcpJson(file, SUBSTRATA_MCP_SPEC, true);
    expect(result.contents).toBeDefined();
    expect(() => readFileSync(file, 'utf8')).toThrow();
  });

  it('removeMcpJson removes the entry idempotently', async () => {
    const dir = path.join(cwd, '.cursor');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'mcp.json');
    mergeMcpJson(file, SUBSTRATA_MCP_SPEC);
    removeMcpJson(file, 'substrata');
    const json = JSON.parse(readFileSync(file, 'utf8'));
    expect(json.mcpServers.substrata).toBeUndefined();
    // Removing again is a no-op.
    removeMcpJson(file, 'substrata');
  });
});

describe('renderMcpConfig', () => {
  it('emits valid mcpServers JSON for generic/claude/cursor/gemini clients', () => {
    for (const client of ['generic', 'claude', 'cursor', 'gemini'] as const) {
      const { hint, body } = renderMcpConfig(client, SUBSTRATA_MCP_SPEC);
      expect(hint.length).toBeGreaterThan(0);
      const parsed = JSON.parse(body);
      expect(parsed.mcpServers.substrata.command).toBe('npx');
      expect(parsed.mcpServers.substrata.args).toEqual(['-y', 'substrata-cli', 'mcp']);
    }
  });

  it('emits TOML for codex', () => {
    const { body } = renderMcpConfig('codex', SUBSTRATA_MCP_SPEC);
    expect(body).toContain('[mcp_servers.substrata]');
    expect(body).toContain('command = "npx"');
    expect(body).toContain('args = ["-y", "substrata-cli", "mcp"]');
  });
});

describe('registry', () => {
  it('includes codex and gemini alongside claude/cursor/windsurf', () => {
    expect(MCP_CLIENTS.map((c) => c.name)).toEqual(
      expect.arrayContaining(['claude', 'cursor', 'windsurf', 'codex', 'gemini']),
    );
    expect(getMcpClient('codex')).toBe(codexClient);
    expect(getMcpClient('gemini')).toBe(geminiClient);
  });
});

describe('geminiClient', () => {
  it('registers project .gemini/settings.json with the substrata server', async () => {
    const result = await geminiClient.register(cwd, SUBSTRATA_MCP_SPEC);
    expect(result.action).toBe('create');
    const json = JSON.parse(readFileSync(path.join(cwd, '.gemini', 'settings.json'), 'utf8'));
    expect(json.mcpServers.substrata.command).toBe('npx');
    expect(json.mcpServers.substrata.args).toEqual(['-y', 'substrata-cli', 'mcp']);
  });

  it('detects via a .gemini directory', async () => {
    expect(await geminiClient.detect(cwd)).toBe(false);
    await mkdir(path.join(cwd, '.gemini'), { recursive: true });
    expect(await geminiClient.detect(cwd)).toBe(true);
  });
});

describe('codexClient', () => {
  // Point HOME at the temp dir so we never touch the real ~/.codex.
  let prevHome: string | undefined;
  beforeEach(() => {
    prevHome = process.env.HOME;
    process.env.HOME = cwd;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  });

  const configFile = (): string => path.join(cwd, '.codex', 'config.toml');

  it('writes an idempotent TOML marker block to ~/.codex/config.toml', async () => {
    const first = await codexClient.register(cwd, SUBSTRATA_MCP_SPEC);
    expect(first.action).toBe('create');
    const toml = readFileSync(configFile(), 'utf8');
    expect(toml).toContain('# >>> substrata >>>');
    expect(toml).toContain('[mcp_servers.substrata]');
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain('args = ["-y", "substrata-cli", "mcp"]');

    const second = await codexClient.register(cwd, SUBSTRATA_MCP_SPEC);
    expect(second.action).toBe('skip');
  });

  it('preserves existing config and is removable', async () => {
    const file = configFile();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'model = "o3"\n', 'utf8');

    await codexClient.register(cwd, SUBSTRATA_MCP_SPEC);
    let toml = readFileSync(file, 'utf8');
    expect(toml).toContain('model = "o3"');
    expect(toml).toContain('[mcp_servers.substrata]');

    await codexClient.unregister(cwd, 'substrata');
    toml = readFileSync(file, 'utf8');
    expect(toml).toContain('model = "o3"');
    expect(toml).not.toContain('[mcp_servers.substrata]');
  });

  it('dry run does not write', async () => {
    const result = await codexClient.register(cwd, SUBSTRATA_MCP_SPEC, true);
    expect(result.contents).toBeDefined();
    expect(existsSync(configFile())).toBe(false);
  });

  it('detects via a ~/.codex directory', async () => {
    expect(await codexClient.detect(cwd)).toBe(false);
    await mkdir(path.join(cwd, '.codex'), { recursive: true });
    expect(await codexClient.detect(cwd)).toBe(true);
  });
});
