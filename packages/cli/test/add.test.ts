import { parseFootprintFile, listFootprints } from '@substrata/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTempRepo, removeDir, runCommand } from './helpers';

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempRepo();
  await runCommand(cwd, ['init', '--yes', '--no-mcp', '--no-env']);
});

afterEach(async () => {
  await removeDir(cwd);
});

describe('add (non-interactive)', () => {
  it('writes a parseable footprint with the provided fields', async () => {
    const result = await runCommand(cwd, [
      'add',
      '--title',
      'Improve learner search performance',
      '--purpose',
      'Reduce latency for large orgs',
      '--actor',
      'claude-code',
      '--files',
      'api/learners.ts,services/LearnerQueryService.ts',
      '--tag',
      'performance',
      '--tag',
      'backend',
      '--decision',
      'Use cursor pagination',
      '--rejected',
      'Redis cache:consistency risk',
      '--work-type',
      'implementation_decision',
    ]);
    expect(result.code).toBe(0);

    const footprints = await listFootprints(cwd);
    expect(footprints.length).toBe(1);
    const fp = await parseFootprintFile(footprints[0]!.filePath);
    expect(fp.title).toBe('Improve learner search performance');
    expect(fp.frontmatter.actor).toBe('claude-code');
    expect(fp.frontmatter.work_type).toBe('implementation_decision');
    expect(fp.frontmatter.tags).toContain('performance');
    expect(fp.frontmatter.files_touched).toContain('api/learners.ts');
    expect(fp.sections.decisions).toContain('Use cursor pagination');
    expect(fp.sections.rejectedOptions?.[0]?.option).toBe('Redis cache');
  });

  it('prints the §12 commit reminder on success', async () => {
    const result = await runCommand(cwd, [
      'add',
      '--title',
      'A footprint',
      '--actor',
      'claude-code',
    ]);
    expect(result.stderr + result.stdout).toContain('intended to be committed');
  });

  it('refuses to write when a secret is detected (exit code != 0)', async () => {
    const fakeSecret = `ghp_${'a'.repeat(36)}`;
    const result = await runCommand(cwd, [
      'add',
      '--title',
      'Leaky footprint',
      '--actor',
      'claude-code',
      '--notes',
      `Here is a token ${fakeSecret} embedded in prose`,
    ]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('github_pat');
    // NEVER print the secret value.
    expect(result.stderr).not.toContain(fakeSecret);

    const footprints = await listFootprints(cwd);
    expect(footprints.length).toBe(0);
  });

  it('--allow-secret overrides the refusal', async () => {
    const fakeSecret = `ghp_${'b'.repeat(36)}`;
    const result = await runCommand(cwd, [
      'add',
      '--title',
      'Allowed leaky footprint',
      '--actor',
      'claude-code',
      '--notes',
      `token ${fakeSecret}`,
      '--allow-secret',
    ]);
    expect(result.code).toBe(0);
    const footprints = await listFootprints(cwd);
    expect(footprints.length).toBe(1);
  });

  it('requires --title in non-interactive mode', async () => {
    const result = await runCommand(cwd, ['add', '--actor', 'claude-code']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('title');
  });
});
