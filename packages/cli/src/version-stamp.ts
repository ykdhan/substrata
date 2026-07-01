import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { localDir } from '@substrata/core';

/**
 * Records which substrata-cli version last ran `init`/`upgrade` in a project, in
 * the always-local (gitignored) state file. Bumping the installed CLI version
 * auto-migrates DATA (config defaults deep-merge; a schema bump auto-rebuilds the
 * index), but SETUP artifacts written by init/upgrade — git hooks, `.gitignore`,
 * `.gitattributes`, the merge driver, editor rules, MCP registrations — are not
 * re-run automatically. Comparing the running version to this stamp lets
 * `doctor` nudge the user to run `substrata upgrade` after a version bump.
 */

const STATE_FILE = 'state.json';

function statePath(cwd: string): string {
  return path.join(localDir(cwd), STATE_FILE);
}

type LocalState = { cli_version?: string; [key: string]: unknown };

function readState(cwd: string): LocalState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(cwd), 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as LocalState)
      : {};
  } catch {
    return {};
  }
}

/** The CLI version that last ran init/upgrade here, or undefined. */
export function readStampedVersion(cwd: string): string | undefined {
  const v = readState(cwd).cli_version;
  return typeof v === 'string' ? v : undefined;
}

/** Record `version` as the CLI that last ran init/upgrade here. Best-effort. */
export function stampVersion(cwd: string, version: string): void {
  try {
    mkdirSync(localDir(cwd), { recursive: true });
    writeFileSync(
      statePath(cwd),
      `${JSON.stringify({ ...readState(cwd), cli_version: version }, null, 2)}\n`,
      'utf8',
    );
  } catch {
    // best-effort: a missing stamp only suppresses the upgrade nudge.
  }
}

/** Parse a dotted numeric version into comparable parts (non-numeric → 0). */
function parts(v: string): number[] {
  return v.split(/[.-]/).map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** True when `a` is a strictly newer version than `b` (numeric semver-ish). */
export function isNewer(a: string, b: string): boolean {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
