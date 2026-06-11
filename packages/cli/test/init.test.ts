import { existsSync, readFileSync } from 'node:fs';
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

describe('init --yes', () => {
  it('creates the scaffold, gitignore, AGENTS.md, and an index', async () => {
    const result = await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);
    expect(result.code).toBe(0);

    expect(existsSync(path.join(cwd, '.substrata', 'config.yml'))).toBe(true);
    expect(existsSync(path.join(cwd, '.substrata', 'footprints'))).toBe(true);
    expect(existsSync(path.join(cwd, '.substrata', 'memory'))).toBe(true);
    expect(existsSync(path.join(cwd, '.substrata', 'templates'))).toBe(true);
    expect(existsSync(path.join(cwd, '.substrata', 'index', 'footprint.sqlite'))).toBe(true);

    const gitignore = readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.substrata/index/');

    const agents = readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('<!-- substrata:start -->');
    expect(agents).toContain('Substrata Rules');
  });

  it('is idempotent: re-run does not duplicate gitignore/AGENTS.md', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);

    const gitignore = readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    const occurrences = gitignore.split('.substrata/index/').length - 1;
    expect(occurrences).toBe(1);

    const agents = readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8');
    expect(agents.split('<!-- substrata:start -->').length - 1).toBe(1);
    expect(agents.split('<!-- substrata:end -->').length - 1).toBe(1);
  });

  it('registers MCP idempotently with --mcp-client claude', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-env', '--mcp-client', 'claude']);
    await runCommand(cwd, ['init', '--yes', '--no-env', '--mcp-client', 'claude']);

    const mcpJson = JSON.parse(readFileSync(path.join(cwd, '.mcp.json'), 'utf8'));
    const keys = Object.keys(mcpJson.mcpServers ?? {});
    expect(keys).toEqual(['substrata']);
    expect(mcpJson.mcpServers.substrata.command).toBe('npx');
  });

  it('--print-config prints config without writing', async () => {
    const result = await runCommand(cwd, ['init', '--print-config']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('schema_version: 1');
    expect(existsSync(path.join(cwd, '.substrata', 'config.yml'))).toBe(false);
  });

  it('--no-redact disables redaction in config', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--no-redact']);
    const config = readFileSync(path.join(cwd, '.substrata', 'config.yml'), 'utf8');
    expect(config).toContain('block_on_secret: false');
  });
});
