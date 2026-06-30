import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '@substrata/core';
import { isSymlink } from './symlink';

/**
 * Add `substrata-cli` to the consuming project's `package.json` devDependencies
 * so teammates who don't have Substrata installed globally get it from a plain
 * `npm install` after cloning — the install→use flow is seamless and version is
 * pinned in the repo.
 *
 * Conservative + idempotent:
 *   - no package.json            -> skip (many repos using Substrata aren't JS).
 *   - already a (dev)dependency  -> skip (never downgrade/overwrite a user pin).
 *   - otherwise                  -> add to devDependencies, preserving 2-space
 *                                   JSON formatting and a trailing newline.
 */

const PKG_NAME = 'substrata-cli';

function readIfExists(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function ensureCliDependency(
  cwd: string,
  version: string,
  dry: boolean = false,
): ChangeResult {
  const filePath = path.join(cwd, 'package.json');
  if (isSymlink(filePath)) {
    return { path: filePath, action: 'skip', description: 'refused: package.json is a symlink' };
  }

  const raw = readIfExists(filePath);
  if (raw === null) {
    return {
      path: filePath,
      action: 'skip',
      description: 'no package.json — skipped substrata-cli devDependency',
    };
  }

  let pkg: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { path: filePath, action: 'skip', description: 'package.json is not an object' };
    }
    pkg = parsed as Record<string, unknown>;
  } catch {
    return { path: filePath, action: 'skip', description: 'package.json is not valid JSON' };
  }

  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  if (PKG_NAME in deps || PKG_NAME in devDeps) {
    return {
      path: filePath,
      action: 'skip',
      description: 'substrata-cli already a project dependency',
    };
  }

  // Insert into devDependencies, keeping keys sorted for a stable diff.
  const nextDev: Record<string, string> = { ...devDeps, [PKG_NAME]: `^${version}` };
  const sortedDev = Object.fromEntries(
    Object.keys(nextDev)
      .sort()
      .map((k) => [k, nextDev[k]!]),
  );
  const nextPkg = { ...pkg, devDependencies: sortedDev };

  const contents = `${JSON.stringify(nextPkg, null, 2)}\n`;
  if (!dry) writeFileSync(filePath, contents, 'utf8');

  return {
    path: filePath,
    action: 'update',
    description: `add ${PKG_NAME}@^${version} to devDependencies`,
    contents,
  };
}
