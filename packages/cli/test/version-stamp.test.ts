import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isNewer, readStampedVersion, stampVersion } from '../src/version-stamp';
import { makeTempRepo, removeDir, runCommand } from './helpers';

describe('isNewer (numeric semver-ish)', () => {
  it('compares versions numerically, not lexically', () => {
    expect(isNewer('0.3.0', '0.2.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.0')).toBe(true); // lexical would be wrong
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('0.2.0', '0.2.0')).toBe(false);
    expect(isNewer('0.2.0', '0.3.0')).toBe(false);
  });
});

describe('version stamp', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeTempRepo();
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  it('init stamps the CLI version into the gitignored local state', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);
    const stamped = readStampedVersion(cwd);
    expect(stamped).toMatch(/^\d+\.\d+\.\d+/);
    // Lives under the always-local dir.
    const raw = readFileSync(path.join(cwd, '.substrata', 'local', 'state.json'), 'utf8');
    expect(JSON.parse(raw).cli_version).toBe(stamped);
  });

  it('doctor warns when the installed CLI is newer than the stamped version', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);
    // Simulate a project set up by an older CLI.
    stampVersion(cwd, '0.0.1');
    const result = await runCommand(cwd, ['doctor']);
    expect(result.stderr + result.stdout).toMatch(/was upgraded.*substrata upgrade/s);
  });

  it('no upgrade nudge when the stamp matches the running version', async () => {
    await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);
    const result = await runCommand(cwd, ['doctor']);
    expect(result.stderr + result.stdout).not.toMatch(/was upgraded/);
  });
});
