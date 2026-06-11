import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { runCli } from '../src/index';
import { setAssumeYes } from '../src/wizard/prompts';

const execFileAsync = promisify(execFile);

/** Create a fresh temp dir and `git init` it (so add/init Git paths work). */
export async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'substrata-cli-'));
  try {
    await execFileAsync('git', ['init'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  } catch {
    // Git not available — tests that need Git should guard on this.
  }
  return dir;
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

/**
 * Run a CLI command against `cwd`, capturing stdout/stderr. Forces
 * non-interactive prompt behavior so the wizard/add use defaults without a TTY.
 * The hidden `--cwd` global option injects the working directory.
 */
export async function runCommand(cwd: string, args: string[]): Promise<RunResult> {
  setAssumeYes(true);

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const prevExitCode = process.exitCode;
  process.exitCode = undefined;

  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stderr.write;

  let code: number;
  try {
    code = await runCli(['node', 'substrata', '--cwd', cwd, ...args]);
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    setAssumeYes(false);
    process.exitCode = prevExitCode;
  }

  return { code, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
}

/** Strip ANSI color codes for stable assertions. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, '');
}
