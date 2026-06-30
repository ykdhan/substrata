import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

  it('generates per-editor rule files by default', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);
    expect(existsSync(path.join(cwd, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(path.join(cwd, 'GEMINI.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.cursor', 'rules', 'substrata.mdc'))).toBe(true);
    // The rules teach agents about the graph tools.
    expect(readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toContain('substrata_graph_context');
  });

  it('--no-editor-rules skips the per-editor rule files', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--no-editor-rules']);
    expect(existsSync(path.join(cwd, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(path.join(cwd, 'GEMINI.md'))).toBe(false);
    expect(existsSync(path.join(cwd, '.cursor', 'rules', 'substrata.mdc'))).toBe(false);
  });
});

describe('init index sharing modes', () => {
  it('default is local: config sharing=local and index/ is gitignored', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);
    const config = readFileSync(path.join(cwd, '.substrata', 'config.yml'), 'utf8');
    expect(config).toMatch(/sharing:\s*local/);
    const gitignore = readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    const lines = gitignore.split('\n').map((l) => l.trim());
    expect(lines).toContain('.substrata/index/');
    expect(lines).toContain('.substrata/local/');
    expect(existsSync(path.join(cwd, '.gitattributes'))).toBe(false);
  });

  it('--sharing shared: commits the DB (no blanket index ignore), keeps telemetry private, writes .gitattributes', async () => {
    const result = await runCommand(cwd, [
      'init',
      '--yes',
      '--no-mcp',
      '--no-env',
      '--sharing',
      'shared',
    ]);
    expect(result.code).toBe(0);

    const config = readFileSync(path.join(cwd, '.substrata', 'config.yml'), 'utf8');
    expect(config).toMatch(/sharing:\s*shared/);

    const gitignore = readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    const lines = gitignore.split('\n').map((l) => l.trim());
    expect(lines).not.toContain('.substrata/index/'); // DB is committed
    expect(lines).toContain('.substrata/index/*.sqlite-journal'); // transient sidecars ignored
    expect(lines).toContain('.substrata/local/'); // telemetry stays private

    // The committed DB exists and is marked binary.
    expect(existsSync(path.join(cwd, '.substrata', 'index', 'footprint.sqlite'))).toBe(true);
    const attrs = readFileSync(path.join(cwd, '.gitattributes'), 'utf8');
    expect(attrs).toContain('.substrata/index/*.sqlite binary');
  });

  it('re-running with --sharing shared flips an existing local config', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--sharing', 'shared']);
    const config = readFileSync(path.join(cwd, '.substrata', 'config.yml'), 'utf8');
    expect(config).toMatch(/sharing:\s*shared/);
    expect(config).not.toMatch(/sharing:\s*local/);
    const lines = readFileSync(path.join(cwd, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim());
    expect(lines).not.toContain('.substrata/index/');
  });
});

describe('init substrata-cli devDependency', () => {
  it('adds substrata-cli to a project package.json devDependencies', async () => {
    writeFileSync(
      path.join(cwd, 'package.json'),
      `${JSON.stringify({ name: 'consumer', version: '1.0.0' }, null, 2)}\n`,
      'utf8',
    );
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);
    const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['substrata-cli']).toMatch(/^\^\d+\.\d+\.\d+/);
  });

  it('--no-cli-dep leaves package.json untouched', async () => {
    const original = `${JSON.stringify({ name: 'consumer' }, null, 2)}\n`;
    writeFileSync(path.join(cwd, 'package.json'), original, 'utf8');
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env', '--no-cli-dep']);
    expect(readFileSync(path.join(cwd, 'package.json'), 'utf8')).toBe(original);
  });
});
