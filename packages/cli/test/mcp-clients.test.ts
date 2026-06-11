import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mergeMcpJson, removeMcpJson } from '../src/mcp-clients/json-config';
import { SUBSTRATA_MCP_SPEC } from '../src/mcp-clients/registry';

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
