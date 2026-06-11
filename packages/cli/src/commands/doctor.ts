import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  GITIGNORE_LINES,
  listFootprints,
  listMemoryDocuments,
  loadConfig,
  substrataDir,
} from '@substrata/core';
import { getIndexStatus } from '@substrata/search';
import type { Command } from 'commander';

import { out, resolveCwd } from '../util';

/**
 * `substrata doctor` — health check (plan §8.8). A missing/stale index is
 * informational (ℹ), not an error. Non-zero exit only for: invalid config,
 * unparseable footprint/memory files, or a gitignore that would commit the DB.
 *
 * Returns the number of hard failures so the program can set the exit code.
 */
export async function runDoctor(cwd: string): Promise<number> {
  let failures = 0;

  // .substrata exists
  if (existsSync(substrataDir(cwd))) {
    out.ok('.substrata exists');
  } else {
    out.err('.substrata missing — run `substrata init`');
    return 1;
  }

  // config valid
  try {
    await loadConfig(cwd);
    out.ok('config valid');
  } catch (err) {
    out.err(`config invalid: ${(err as Error).message}`);
    failures += 1;
  }

  // index status (informational only)
  const status = await getIndexStatus(cwd);
  if (status.state === 'fresh') {
    out.ok('index fresh');
  } else if (status.state === 'missing') {
    out.info('index missing — run `substrata index` (or it builds automatically on first search)');
  } else {
    out.info(`index stale (${status.reason}) — run \`substrata index\``);
  }

  // gitignore covers index/ and cache/ (else the generated DB would be committed)
  const gitignorePath = path.join(cwd, '.gitignore');
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const ignoredLines = new Set(gitignore.split(/\r?\n/).map((l) => l.trim()));
  const indexCovered = ignoredLines.has('.substrata/index/') || ignoredLines.has('.substrata/');
  if (indexCovered) {
    out.ok('gitignore covers index/ and cache/');
  } else {
    out.err(`gitignore would commit the generated DB — add: ${GITIGNORE_LINES.join(', ')}`);
    failures += 1;
  }

  // footprints parse
  try {
    const footprints = await listFootprints(cwd);
    out.ok(`${footprints.length} footprint file(s) parsed`);
  } catch (err) {
    out.err(`footprint parse error: ${(err as Error).message}`);
    failures += 1;
  }

  // memory parses
  try {
    const memory = await listMemoryDocuments(cwd);
    out.ok(`${memory.length} memory file(s) parsed`);
  } catch (err) {
    out.err(`memory parse error: ${(err as Error).message}`);
    failures += 1;
  }

  return failures;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check repository setup')
    .action(async (_opts: unknown, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      const failures = await runDoctor(cwd);
      if (failures > 0) {
        process.exitCode = 1;
      }
    });
}
