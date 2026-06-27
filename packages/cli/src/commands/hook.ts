import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { installClaudeHooks, installSecretHook, loadConfig, scanForSecrets } from '@substrata/core';
import type { Command } from 'commander';

import { emitContext, emitStopDecision, readHookPayload, runHook } from '../hooks/claude-code';
import { buildGraphHookContext, buildHookContext, recentDigest } from '../hooks/context';
import { collectGitContext, git, out, resolveCwd } from '../util';

/**
 * `substrata hook` groups two families of hooks:
 *   - Pre-commit secret scan: `install` / `run` (+ internal alias).
 *   - Claude Code lifecycle hooks (IMPROVEMENT_PLAN M1): `claude` installs the
 *     `.claude/settings.json` block; `session-start` / `prompt-submit` /
 *     `session-end` are the runtime handlers Claude Code invokes with a JSON
 *     payload on stdin. The runtime handlers fail open — they never block a
 *     session and emit nothing on error.
 */

/**
 * Scan staged `.substrata/**` files for secrets. Returns the number of files
 * with findings (0 = clean). Prints pattern names + line numbers, never values.
 */
async function scanStaged(cwd: string): Promise<number> {
  const staged = await git(cwd, ['diff', '--cached', '--name-only']);
  if (!staged) return 0;

  const files = staged
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('.substrata/') && l.endsWith('.md'));

  let flagged = 0;
  for (const rel of files) {
    let content: string;
    try {
      content = await readFile(path.join(cwd, rel), 'utf8');
    } catch {
      continue;
    }
    const findings = scanForSecrets(content);
    if (findings.length > 0) {
      flagged += 1;
      out.err(`${findings.length} potential secret(s) in ${rel}:`);
      for (const f of findings) out.plain(`  - ${f.name} at line ${f.line}`);
    }
  }
  return flagged;
}

export function registerHookCommand(program: Command): void {
  const hook = program.command('hook').description('Secret-scan and Claude Code lifecycle hooks');

  hook
    .command('install')
    .description('Install the pre-commit secret scan hook')
    .action(async (_opts: unknown, command: Command) => {
      const cwd = resolveCwd(command.parent?.parent?.opts());
      const result = installSecretHook(cwd);
      if (result.action === 'skip') {
        out.info('Pre-commit hook already installed.');
      } else {
        out.ok(`Pre-commit hook ${result.action === 'create' ? 'installed' : 'updated'}.`);
      }
    });

  hook
    .command('run')
    .description('Scan staged .substrata files for secrets')
    .action(async (_opts: unknown, command: Command) => {
      const cwd = resolveCwd(command.parent?.parent?.opts());
      const flagged = await scanStaged(cwd);
      if (flagged > 0) process.exitCode = 1;
    });

  // --- Claude Code lifecycle hooks (M1) ------------------------------------

  hook
    .command('claude')
    .description('Install/remove the Substrata Claude Code lifecycle hooks (.claude/settings.json)')
    .option('--remove', 'Remove the Substrata hooks instead of installing them')
    .action(async (opts: { remove?: boolean }, command: Command) => {
      const cwd = resolveCwd(command.parent?.parent?.opts());
      const result = installClaudeHooks(cwd, false, { remove: opts.remove });
      if (result.action === 'skip') {
        out.info(result.description);
      } else if (opts.remove) {
        out.ok('Claude Code lifecycle hooks removed.');
      } else {
        out.ok(
          `Claude Code lifecycle hooks ${result.action === 'create' ? 'installed' : 'updated'}.`,
        );
        out.plain(`  ${result.path}`);
        out.info('Substrata context is now injected on session start / each prompt automatically.');
      }
    });

  registerLifecycleHandlers(hook);

  // The installed pre-commit hook script invokes this name directly.
  program
    .command('internal-scan-staged', { hidden: true })
    .action(async (_opts: unknown, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      const flagged = await scanStaged(cwd);
      if (flagged > 0) process.exitCode = 1;
    });
}

/** The three runtime handlers Claude Code invokes with a JSON payload on stdin. */
function registerLifecycleHandlers(hook: Command): void {
  hook
    .command('session-start', { hidden: true })
    .description('Claude Code SessionStart handler (stdin payload -> injected context)')
    .action(async (_opts: unknown, command: Command) => {
      const cwd = resolveCwd(command.parent?.parent?.opts());
      await runHook(async () => {
        await readHookPayload();
        const config = await loadConfig(cwd);
        if (!config.hooks.enabled || !config.hooks.inject_context) return;
        const digest = await recentDigest(cwd, config);
        emitContext('SessionStart', digest ?? undefined);
      });
    });

  hook
    .command('prompt-submit', { hidden: true })
    .description('Claude Code UserPromptSubmit handler (stdin payload -> injected context)')
    .action(async (_opts: unknown, command: Command) => {
      const cwd = resolveCwd(command.parent?.parent?.opts());
      await runHook(async () => {
        const payload = await readHookPayload();
        const config = await loadConfig(cwd);
        if (!config.hooks.enabled || !config.hooks.inject_context) return;
        const query = typeof payload.prompt === 'string' ? payload.prompt : '';

        // Prefer graph-aware context; degrade to FTS, then to no injection
        // (graph-rag-implementation.md "Hook 개선": Graph → FTS → skip).
        let context: string | null = null;
        if (config.graph.enabled && config.search.hybrid_graph) {
          try {
            context = await buildGraphHookContext(cwd, config, { query });
          } catch {
            context = null;
          }
        }
        if (context === null) {
          context = await buildHookContext(cwd, config, { query });
        }
        emitContext('UserPromptSubmit', context ?? undefined);
      });
    });

  hook
    .command('session-end', { hidden: true })
    .description('Claude Code Stop/SubagentStop handler (footprint reminder)')
    .option('--subagent', 'Invoked from SubagentStop (reminders are suppressed)')
    .action(async (opts: { subagent?: boolean }, command: Command) => {
      const cwd = resolveCwd(command.parent?.parent?.opts());
      await runHook(async () => {
        const payload = await readHookPayload();
        // Never loop: if we already blocked once this turn, let the agent stop.
        if (payload.stop_hook_active) return;
        // Suppress on subagents — fan-out would otherwise flood the project with
        // footprints (IMPROVEMENT_PLAN §7 risk).
        if (opts.subagent) return;

        const config = await loadConfig(cwd);
        if (!config.hooks.enabled || !config.hooks.remind_on_stop) return;
        if (!config.agent.require_footprint_after_non_trivial_work) return;

        const ctx = await collectGitContext(cwd);
        // If a footprint was already recorded this session, the loop is closed —
        // don't nag.
        if (ctx.files.some((f) => f.startsWith('.substrata/footprints/'))) return;
        // Count only real code/docs changes: Substrata's own scaffold/memory
        // edits shouldn't, by themselves, demand a footprint.
        const work = ctx.files.filter((f) => !f.startsWith('.substrata/'));
        if (work.length < config.hooks.non_trivial_threshold) return;

        emitStopDecision(
          `Non-trivial work this session (${work.length} changed file(s)) but no footprint was recorded. ` +
            'Before finishing, capture the decisions/learnings with the `substrata_add` tool ' +
            '(or `substrata add`). If a footprint already exists or none is warranted, you may stop.',
        );
      });
    });
}
