import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  ensureGitignore,
  substrataDir,
  upsertAgentsMd,
  upsertClaudeMd,
  upsertCursorRule,
  upsertGeminiMd,
  type ChangeResult,
} from '@substrata/core';
import { buildGraph, buildIndex } from '@substrata/search';
import type { Command } from 'commander';

import { codexClient } from '../mcp-clients/codex';
import { mergeMcpJson } from '../mcp-clients/json-config';
import { SUBSTRATA_MCP_SPEC } from '../mcp-clients/registry';
import { CliError, out, requireConfig, resolveCwd } from '../util';

/**
 * `substrata upgrade` — refresh generated artifacts after upgrading the CLI.
 * Non-interactive and strictly conservative: it only updates what `init`
 * previously set up (marker-delimited AGENTS.md section, gitignore lines,
 * existing MCP registrations) and rebuilds the index. It never adds new
 * integrations the user opted out of — re-run `init` for that.
 */

function hasSubstrataMcpEntry(filePath: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
    return Boolean(parsed.mcpServers?.[SUBSTRATA_MCP_SPEC.name]);
  } catch {
    return false;
  }
}

function report(result: ChangeResult, label: string): void {
  if (result.action === 'skip') {
    out.info(`${label}: ${result.description}`);
  } else {
    out.ok(`${label} ${result.action === 'create' ? 'created' : 'updated'}.`);
  }
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description(
      'Refresh generated artifacts (AGENTS.md section, gitignore, MCP registrations) after upgrading substrata-cli',
    )
    .option('--no-index', 'Skip rebuilding the search index')
    .action(async (opts: { index?: boolean }, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());

      if (!existsSync(substrataDir(cwd))) {
        throw new CliError(
          'No .substrata directory found. Run `npx substrata-cli init` to set up this repository.',
        );
      }
      const config = await requireConfig(cwd);

      report(ensureGitignore(cwd), '.gitignore');

      // Refresh the AGENTS.md section only where init previously wrote it.
      const agentsPath = path.join(cwd, 'AGENTS.md');
      if (
        existsSync(agentsPath) &&
        readFileSync(agentsPath, 'utf8').includes('<!-- substrata:start -->')
      ) {
        report(upsertAgentsMd(cwd), 'AGENTS.md section');
      } else {
        out.info('AGENTS.md: no Substrata section found — skipped (run `init` to add one).');
      }

      // Refresh per-editor rule files only where init previously wrote them
      // (so a version bump propagates new guidance like the graph tools).
      for (const { label, file, refresh } of [
        { label: 'CLAUDE.md section', file: path.join(cwd, 'CLAUDE.md'), refresh: upsertClaudeMd },
        { label: 'GEMINI.md section', file: path.join(cwd, 'GEMINI.md'), refresh: upsertGeminiMd },
      ]) {
        if (existsSync(file) && readFileSync(file, 'utf8').includes('<!-- substrata:start -->')) {
          report(refresh(cwd), label);
        }
      }
      const cursorRule = path.join(cwd, '.cursor', 'rules', 'substrata.mdc');
      if (existsSync(cursorRule)) {
        report(upsertCursorRule(cwd), 'Cursor rule');
      }

      // Re-merge existing MCP registrations so drifted entries pick up the
      // current server spec. Never registers new clients.
      const mcpConfigs = [
        { label: 'Claude Code (.mcp.json)', file: path.join(cwd, '.mcp.json') },
        { label: 'Cursor (.cursor/mcp.json)', file: path.join(cwd, '.cursor', 'mcp.json') },
        {
          label: 'Gemini (.gemini/settings.json)',
          file: path.join(cwd, '.gemini', 'settings.json'),
        },
      ];
      for (const { label, file } of mcpConfigs) {
        if (hasSubstrataMcpEntry(file)) {
          report(mergeMcpJson(file, SUBSTRATA_MCP_SPEC), label);
        }
      }
      // Codex is a global TOML config; refresh only if its managed block exists.
      const codexConfig = path.join(homedir(), '.codex', 'config.toml');
      if (
        existsSync(codexConfig) &&
        readFileSync(codexConfig, 'utf8').includes('# >>> substrata >>>')
      ) {
        report(await codexClient.register(cwd, SUBSTRATA_MCP_SPEC), 'Codex (~/.codex/config.toml)');
      }

      if (opts.index !== false) {
        await buildIndex(cwd);
        if (config.graph.enabled) {
          await buildGraph(cwd);
          out.ok('Search + graph index rebuilt.');
        } else {
          out.ok('Search index rebuilt.');
        }
      }

      out.plain('');
      out.ok('Upgrade complete.');
    });
}
