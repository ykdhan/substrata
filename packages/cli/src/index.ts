import { Command } from 'commander';
import pc from 'picocolors';

import { registerAddCommand } from './commands/add';
import { registerBenchCommand } from './commands/bench';
import { registerContextCommand } from './commands/context';
import { registerDoctorCommand } from './commands/doctor';
import { registerGcCommand } from './commands/gc';
import { registerGraphCommand } from './commands/graph';
import { registerHookCommand } from './commands/hook';
import { registerIndexCommand } from './commands/index';
import { registerInitCommand } from './commands/init';
import { registerInternalMergeDbCommand } from './commands/internal-merge-db';
import { registerInternalRefreshIndexCommand } from './commands/internal-refresh-index';
import { registerListCommand } from './commands/list';
import { registerMcpCommand } from './commands/mcp';
import { registerMemoryUpdateCommand } from './commands/memory-update';
import { registerSearchCommand } from './commands/search';
import { registerShowCommand } from './commands/show';
import { registerStatsCommand } from './commands/stats';
import { registerSupersedeCommand } from './commands/supersede';
import { registerUpgradeCommand } from './commands/upgrade';
import { CliError, out } from './util';
import pkg from '../package.json';
import { PromptCancelledError } from './wizard/prompts';

/**
 * Build the commander program. Exported for tests: callers can do
 * `buildProgram().parseAsync(['node','substrata', ...])` and inject a cwd via the
 * hidden global `--cwd` option.
 *
 * Exit codes: 0 success, 1 user/expected errors (friendly, no stack), 2 unexpected.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('substrata')
    .description('Shared project memory for AI engineering agents')
    .version(pkg.version)
    // Hidden global flag so tests can run commands against a temp dir.
    .option('--cwd <dir>', 'Run as if invoked from this directory')
    .enablePositionalOptions();

  // Don't let commander call process.exit() during tests/embedding.
  program.exitOverride();

  registerInitCommand(program);
  registerAddCommand(program);
  registerSearchCommand(program);
  registerContextCommand(program);
  registerIndexCommand(program);
  registerListCommand(program);
  registerShowCommand(program);
  registerDoctorCommand(program);
  registerSupersedeCommand(program);
  registerStatsCommand(program);
  registerGcCommand(program);
  registerGraphCommand(program);
  registerMemoryUpdateCommand(program);
  registerBenchCommand(program);
  registerHookCommand(program);
  registerUpgradeCommand(program);
  registerMcpCommand(program);
  registerInternalMergeDbCommand(program);
  registerInternalRefreshIndexCommand(program);

  return program;
}

/** Map an unknown error to an exit code, printing a friendly message. */
function reportError(err: unknown): number {
  if (err instanceof CliError) {
    out.err(err.message);
    return err.exitCode;
  }
  if (err instanceof PromptCancelledError) {
    out.info('Cancelled.');
    return 1;
  }
  // Commander throws CommanderError for help/version/parse issues.
  const e = err as { code?: string; exitCode?: number; message?: string };
  if (e && typeof e.code === 'string' && e.code.startsWith('commander.')) {
    // help/version are not failures.
    if (e.code === 'commander.helpDisplayed' || e.code === 'commander.version') return 0;
    if (e.message) out.err(e.message);
    return typeof e.exitCode === 'number' ? e.exitCode : 1;
  }
  // Unexpected: surface the message without a stack, exit 2.
  out.err(`Unexpected error: ${(err as Error)?.message ?? String(err)}`);
  process.stderr.write(`${pc.dim('This is a bug — please file an issue.')}\n`);
  return 2;
}

/** Parse argv and run. Returns the process exit code (does not call exit). */
export async function runCli(argv: string[]): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
    return Number(process.exitCode ?? 0);
  } catch (err) {
    return reportError(err);
  }
}
