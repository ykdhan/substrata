import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { installSecretHook, scanForSecrets } from '@substrata/core';
import type { Command } from 'commander';

import { git, out, resolveCwd } from '../util';

/**
 * `substrata hook install` — install the pre-commit secret hook (plan §8.11).
 * `substrata hook run` (and the internal `internal-scan-staged` alias the hook
 * script invokes) — scan staged `.substrata` files and exit 1 on findings.
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
  const hook = program.command('hook').description('Pre-commit secret hook utilities');

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

  // The installed hook script invokes this name directly.
  program
    .command('internal-scan-staged', { hidden: true })
    .action(async (_opts: unknown, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      const flagged = await scanStaged(cwd);
      if (flagged > 0) process.exitCode = 1;
    });
}
