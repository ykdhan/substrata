import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  graphPath,
  indexPath,
  listFootprints,
  listMemoryDocuments,
  loadConfig,
  substrataDir,
} from '@substrata/core';
import { gitignoreLinesFor } from '@substrata/editor-integrations';
import { claudeHooksInstalled } from '@substrata/hooks';
import { getGraphStatus, getIndexStatus, readStats } from '@substrata/index';
import type { Command } from 'commander';

import { out, resolveCwd } from '../util';
import { isNewer, readStampedVersion } from '../version-stamp';

import pkg from '../../package.json';

/** Footprints older than this (days) count as "no recent activity". */
const RECENT_ACTIVITY_DAYS = 14;
/** Warn when reads per write fall below this — memory is written but not read. */
const MIN_READ_WRITE_RATIO = 1;
/** Warn when the committed shared DB grows past this (bytes) — git history bloat. */
const SHARED_DB_WARN_BYTES = 25 * 1024 * 1024;

/**
 * Shared-mode health: the committed index/graph DB is what teammates consume, so
 * a stale DB (markdown changed but the DB wasn't rebuilt+committed) or an
 * oversized DB (git history bloat) is worth a non-fatal warning. Advisory only.
 */
async function reportSharedDbHealth(cwd: string): Promise<void> {
  const [fts, graph] = await Promise.all([getIndexStatus(cwd), getGraphStatus(cwd)]);
  const stale = [
    fts.state === 'stale' || fts.state === 'missing' ? 'FTS' : null,
    graph.state === 'stale' || graph.state === 'missing' ? 'graph' : null,
  ].filter(Boolean);
  if (stale.length > 0) {
    out.warn(
      `shared ${stale.join(' + ')} index is out of date with the committed markdown — teammates would get stale memory.`,
    );
    out.plain('    Rebuild and commit: `substrata index` then `git add .substrata/index`.');
  } else {
    out.ok('shared index DB is in sync with the committed markdown');
  }

  let bytes = 0;
  for (const p of [indexPath(cwd), graphPath(cwd)]) {
    try {
      bytes += statSync(p).size;
    } catch {
      // missing file already covered by the staleness check above.
    }
  }
  if (bytes > SHARED_DB_WARN_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(0);
    out.warn(
      `committed index DB is large (${mb} MB) — every change adds a full binary blob to git history.`,
    );
    out.plain('    Consider `storage.sharing: local` if history size becomes a concern.');
  }
}

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

  // gitignore must always keep the local telemetry log private; the index DB is
  // ignored in 'local' mode and intentionally committed in 'shared' mode.
  const gitignorePath = path.join(cwd, '.gitignore');
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const ignoredLines = new Set(gitignore.split(/\r?\n/).map((l) => l.trim()));
  const blanketIgnored = ignoredLines.has('.substrata/') || ignoredLines.has('.substrata/index/');

  let sharing: 'local' | 'shared' = 'local';
  try {
    sharing = (await loadConfig(cwd)).storage.sharing;
  } catch {
    // fall back to local; a broken config is already reported elsewhere.
  }

  const telemetryCovered = ignoredLines.has('.substrata/local/') || ignoredLines.has('.substrata/');
  if (!telemetryCovered) {
    out.err('gitignore would commit the local telemetry log — add: .substrata/local/');
    failures += 1;
  }

  if (sharing === 'shared') {
    if (blanketIgnored) {
      out.warn(
        'storage.sharing=shared but .gitignore still ignores .substrata/index/ — the shared DB will NOT be committed.',
      );
      out.plain('    Re-run `substrata init` (or `substrata upgrade`) to refresh .gitignore.');
    } else if (telemetryCovered) {
      out.ok('gitignore allows the shared index DB to be committed (telemetry stays local)');
    }
  } else if (blanketIgnored) {
    out.ok('gitignore covers index/ and cache/ (local mode)');
  } else {
    out.err(
      `gitignore would commit the generated DB — add: ${gitignoreLinesFor('local').join(', ')}`,
    );
    failures += 1;
  }

  // Shared mode only: the committed DB is what the team consumes, so warn (loudly,
  // but non-fatally) if it has drifted from the markdown, or grown large enough to
  // bloat git history.
  if (sharing === 'shared') {
    await reportSharedDbHealth(cwd);
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

  // Version-drift nudge: config + index auto-migrate on use, but setup artifacts
  // (git hooks, gitignore/attributes, editor rules, MCP regs) are only refreshed
  // by `substrata upgrade`. Warn when the installed CLI is newer than the one
  // that last set this project up.
  const stamped = readStampedVersion(cwd);
  if (stamped && isNewer(pkg.version, stamped)) {
    out.warn(
      `substrata-cli was upgraded (${stamped} → ${pkg.version}) — run \`substrata upgrade\` to refresh hooks, rules, and generated files.`,
    );
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
  // Health checks are advisory and must respect intent: if a feature is turned
  // off in config, warning about it would be noise. Load best-effort — a broken
  // config is already reported as a hard failure above.
  let config;
  try {
    config = await loadConfig(cwd);
  } catch {
    return;
  }

  // Lifecycle hooks installed? Only relevant when hooks are enabled.
  if (!config.hooks.enabled) {
    out.info('Claude Code hooks disabled by config (hooks.enabled = false)');
  } else if (claudeHooksInstalled(cwd)) {
    out.ok('Claude Code hooks installed');
  } else {
    out.warn('Claude Code hooks not installed — retrieval/recording is not automatic.');
    out.plain(
      '    Run `substrata hook claude` to enable auto context injection + footprint reminders.',
    );
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
      out.warn(
        `No footprints in the last ${RECENT_ACTIVITY_DAYS} days — memory may be going stale.`,
      );
    } else {
      out.ok(`${recent} footprint(s) in the last ${RECENT_ACTIVITY_DAYS} days`);
    }
  }

  // Read:write ratio (the headline health metric from the analysis). Reads are
  // only logged when telemetry is on, so the ratio is meaningless otherwise.
  if (!config.telemetry.enabled) {
    out.info(
      'Telemetry disabled by config (telemetry.enabled = false) — skipping read:write ratio',
    );
    return;
  }
  const stats = readStats(cwd);
  const writes = footprints.length;
  if (writes > 0) {
    const reads = stats.totalReads;
    const ratio = reads / writes;
    if (reads === 0) {
      out.warn(
        'read:write ratio is 0:1 — stored memory is never read back. Are the hooks installed?',
      );
    } else if (ratio < MIN_READ_WRITE_RATIO) {
      out.warn(
        `Low read:write ratio (${ratio.toFixed(2)}:1) — memory is written more than it is read.`,
      );
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
