import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  GITIGNORE_LINES,
  claudeHooksInstalled,
  listFootprints,
  listMemoryDocuments,
  loadConfig,
  substrataDir,
} from '@substrata/core';
import { getIndexStatus, readStats } from '@substrata/search';
import type { Command } from 'commander';

import { out, resolveCwd } from '../util';

/** Footprints older than this (days) count as "no recent activity". */
const RECENT_ACTIVITY_DAYS = 14;
/** Warn when reads per write fall below this — memory is written but not read. */
const MIN_READ_WRITE_RATIO = 1;

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

  // Health warnings (informational; never affect the exit code). These automate
  // the manual checks the loop-recovery analysis had to do by hand (plan P3).
  await reportHealth(cwd);

  return failures;
}

/**
 * Emit health warnings: hooks not installed, no recent footprints, and a low
 * read:write ratio (memory written more than it is read). Warnings only — they
 * surface risks without failing `doctor`.
 */
async function reportHealth(cwd: string): Promise<void> {
  // Lifecycle hooks installed?
  if (claudeHooksInstalled(cwd)) {
    out.ok('Claude Code hooks installed');
  } else {
    out.warn('Claude Code hooks not installed — retrieval/recording is not automatic.');
    out.plain('    Run `substrata hook claude` to enable auto context injection + footprint reminders.');
  }

  // Recent footprint activity.
  let footprints;
  try {
    footprints = await listFootprints(cwd);
  } catch {
    return; // already reported above as a parse error
  }
  if (footprints.length === 0) {
    out.info('No footprints yet — memory will fill in as agents work.');
  } else {
    const cutoff = new Date(Date.now() - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const recent = footprints.filter((fp) => (fp.frontmatter.created_at ?? '') >= cutoff).length;
    if (recent === 0) {
      out.warn(`No footprints in the last ${RECENT_ACTIVITY_DAYS} days — memory may be going stale.`);
    } else {
      out.ok(`${recent} footprint(s) in the last ${RECENT_ACTIVITY_DAYS} days`);
    }
  }

  // Read:write ratio (the headline health metric from the analysis).
  const stats = readStats(cwd);
  const writes = footprints.length;
  if (writes > 0) {
    const reads = stats.totalReads;
    const ratio = reads / writes;
    if (reads === 0) {
      out.warn('read:write ratio is 0:1 — stored memory is never read back. Are the hooks installed?');
    } else if (ratio < MIN_READ_WRITE_RATIO) {
      out.warn(`Low read:write ratio (${ratio.toFixed(2)}:1) — memory is written more than it is read.`);
    } else {
      out.ok(`read:write ratio ${ratio.toFixed(2)}:1`);
    }
  }
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
