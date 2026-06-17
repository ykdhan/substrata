import { readFile, writeFile } from 'node:fs/promises';

import { configPath } from '@substrata/core';
import { buildIndex } from '@substrata/search';
import type { Command } from 'commander';

import { printResolvedConfig, runInitWizard, type InitFlags } from '../wizard/init-wizard';
import { setAssumeYes } from '../wizard/prompts';
import { out, resolveCwd } from '../util';

import { runDoctor } from './doctor';

/**
 * `substrata init` — one-command setup wizard (plan §8.1). Non-TTY/`--yes`
 * accepts all defaults. After applying, builds the initial index (unless
 * `--no-index`) and then runs the embedded doctor health check.
 */

/** Disable redaction in the written config when `--no-redact` was passed. */
async function disableRedaction(cwd: string): Promise<void> {
  const file = configPath(cwd);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return;
  }
  const next = raw
    .replace(/^(\s*)redact:\s*true\s*$/m, '$1redact: false')
    .replace(/^(\s*)scan_content:\s*true\s*$/m, '$1scan_content: false')
    .replace(/^(\s*)block_on_secret:\s*true\s*$/m, '$1block_on_secret: false');
  if (next !== raw) await writeFile(file, next, 'utf8');
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Set up Substrata in this repository (interactive wizard)')
    .option('--yes', 'Accept all defaults, no prompts')
    .option('--project <name>', 'Project name')
    .option('--actor <id>', 'Default actor')
    .option('--model <id>', 'Default agent model')
    .option('--requester <id>', 'Default requester')
    .option('--no-env', "Don't touch shell rc; print snippet instead")
    .option('--no-agents-md', 'Skip AGENTS.md')
    .option('--no-mcp', 'Skip MCP registration')
    .option('--mcp-client <name>', 'Register only this client (repeatable)', collect, [])
    .option('--no-gitignore', "Don't edit .gitignore")
    .option('--no-redact', 'Disable security redaction (NOT recommended)')
    .option('--with-hook', 'Install the pre-commit secret hook')
    .option('--claude-hooks', 'Install Claude Code lifecycle hooks (no prompt)')
    .option('--no-claude-hooks', 'Skip Claude Code lifecycle hooks')
    .option('--no-index', 'Skip building the initial index')
    .option('--print-config', 'Print resolved config.yml without writing anything')
    .action(async (opts: InitCommandOptions, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());

      const flags: InitFlags = {
        yes: opts.yes,
        project: opts.project,
        actor: opts.actor,
        model: opts.model,
        requester: opts.requester,
        env: opts.env,
        agentsMd: opts.agentsMd,
        mcp: opts.mcp,
        mcpClient: opts.mcpClient,
        gitignore: opts.gitignore,
        redact: opts.redact,
        withHook: opts.withHook,
        claudeHooks: opts.claudeHooks,
        index: opts.index,
        printConfig: opts.printConfig,
      };

      if (flags.printConfig) {
        printResolvedConfig(cwd, flags);
        return;
      }

      // Non-TTY contexts behave as --yes (handled inside the prompt wrapper too).
      if (flags.yes) setAssumeYes(true);

      const result = await runInitWizard(cwd, flags);
      if (result.aborted) return;

      if (flags.redact === false) {
        await disableRedaction(cwd);
        out.warn('Security redaction disabled (--no-redact).');
      }

      // Build the initial index first so the health check below reports it
      // as fresh instead of telling the user it is missing.
      if (flags.index !== false) {
        await buildIndex(cwd);
        out.ok('Initial index built.');
      }

      // Embedded health check (doctor logic).
      out.plain('');
      await runDoctor(cwd);

      out.plain('');
      out.plain('You are set. Agents pick up Substrata automatically from here:');
      out.plain('  - AGENTS.md tells them to check context before work and leave footprints after');
      out.plain('  - registered MCP clients expose substrata_context / substrata_add as tools');
      out.plain('');
      out.plain('To try it yourself:');
      out.plain('  npx substrata-cli context "<what you are about to work on>"');
      out.plain('');
      out.plain('Note: npx does not install a global binary. For a bare `substrata`');
      out.plain('command, run: npm install -g substrata-cli');
    });
}

type InitCommandOptions = {
  yes?: boolean;
  project?: string;
  actor?: string;
  model?: string;
  requester?: string;
  env?: boolean;
  agentsMd?: boolean;
  mcp?: boolean;
  mcpClient?: string[];
  gitignore?: boolean;
  redact?: boolean;
  withHook?: boolean;
  claudeHooks?: boolean;
  index?: boolean;
  printConfig?: boolean;
};

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
