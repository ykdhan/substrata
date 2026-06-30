import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { loadConfig, type SubstrataConfig } from '@substrata/core';
import { logAccess, type AccessEntry } from '@substrata/index';
import pc from 'picocolors';

/**
 * Shared CLI helpers: cwd resolution, git shell-outs, attribution precedence,
 * and a typed error class for friendly (exit 1) failures.
 */

const execFileAsync = promisify(execFile);

/** A user/expected error: printed as a friendly message, no stack, exit code 1. */
export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/** Resolve the working directory from the hidden global `--cwd` option. */
export function resolveCwd(opts: { cwd?: string } | undefined): string {
  return opts?.cwd ? opts.cwd : process.cwd();
}

export const out = {
  ok: (msg: string) => process.stdout.write(`${pc.green('✔')} ${msg}\n`),
  info: (msg: string) => process.stdout.write(`${pc.blue('ℹ')} ${msg}\n`),
  warn: (msg: string) => process.stderr.write(`${pc.yellow('!')} ${msg}\n`),
  err: (msg: string) => process.stderr.write(`${pc.red('✖')} ${msg}\n`),
  plain: (msg: string) => process.stdout.write(`${msg}\n`),
};

/** Run a git command in `cwd`; returns trimmed stdout or null on failure. */
export async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** True if `cwd` is inside a git work tree. */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return result === 'true';
}

export type GitContext = {
  branch?: string;
  files: string[];
  commit?: string;
};

/** Collect branch, changed files (staged + unstaged), and HEAD commit. */
export async function collectGitContext(cwd: string): Promise<GitContext> {
  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])) ?? undefined;
  const commit = (await git(cwd, ['rev-parse', 'HEAD'])) ?? undefined;

  const staged = await git(cwd, ['diff', '--cached', '--name-only']);
  const unstaged = await git(cwd, ['diff', '--name-only']);
  const files = new Set<string>();
  for (const block of [staged, unstaged]) {
    if (!block) continue;
    for (const line of block.split(/\r?\n/)) {
      const t = line.trim();
      if (t.length > 0) files.add(t);
    }
  }

  return {
    branch: branch && branch !== 'HEAD' ? branch : undefined,
    files: Array.from(files),
    commit,
  };
}

export type Attribution = {
  actor: string;
  model?: string;
  requester?: string;
};

/**
 * Resolve actor / model / requester by the precedence in plan §8.2.
 *   actor:     --actor → $SUBSTRATA_ACTOR → config.agent.default_actor → "unknown-agent"
 *   model:     --model → $SUBSTRATA_MODEL → config.agent.default_model → omit
 *   requester: --requester → $SUBSTRATA_REQUESTER → git user.email → omit
 */
export async function resolveAttribution(
  cwd: string,
  config: SubstrataConfig,
  flags: { actor?: string; model?: string; requester?: string },
): Promise<Attribution> {
  const env = process.env;

  const actor = flags.actor || env.SUBSTRATA_ACTOR || config.agent.default_actor || 'unknown-agent';

  const model = flags.model || env.SUBSTRATA_MODEL || config.agent.default_model || undefined;

  let requester = flags.requester || env.SUBSTRATA_REQUESTER || undefined;
  if (!requester) {
    const email = await git(cwd, ['config', 'user.email']);
    if (email) requester = email;
  }

  return { actor, model, requester };
}

/**
 * Record a read in the local access log when telemetry is enabled. Honors
 * `store_queries` and never throws (logging is best-effort).
 */
export function recordAccess(cwd: string, config: SubstrataConfig, entry: AccessEntry): void {
  if (!config.telemetry.enabled) return;
  try {
    logAccess(cwd, entry, { storeQuery: config.telemetry.store_queries });
  } catch {
    // Best-effort: telemetry failures must never block a CLI command.
  }
}

/** Load config, mapping a missing/invalid config to a friendly CliError. */
export async function requireConfig(cwd: string): Promise<SubstrataConfig> {
  try {
    return await loadConfig(cwd);
  } catch (err) {
    throw new CliError(
      `${(err as Error).message}\nRun \`substrata init\` to set up this repository.`,
    );
  }
}
