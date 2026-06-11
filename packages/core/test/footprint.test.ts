import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listFootprints, parseFootprint, SecretDetectedError, writeFootprint } from '../src/index';
import { makeInitedProject, removeDir } from './helpers';

describe('writeFootprint → parse round-trip', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeInitedProject();
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  it('writes a footprint and preserves sections on re-parse', async () => {
    const fp = await writeFootprint({
      cwd,
      title: 'Improve learner search performance',
      purpose: 'Reduce latency for large organizations.',
      actor: 'claude-code',
      requester: 'david.han',
      workType: 'implementation_decision',
      decisions: ['Use cursor pagination.'],
      rejectedOptions: [{ option: 'Redis cache', reason: 'Consistency risk.' }],
      implementationNotes: 'Added cursor params.',
      commandsRun: ['pnpm test learner-search'],
      memoryLearned: ['Use LearnerQueryService.'],
      futureAgentGuidance: 'Check LearnerQueryService first.',
      filesTouched: ['api/learners.ts'],
      tags: ['learner-search', 'performance'],
    });

    expect(fp.frontmatter.id).toMatch(/^fp_\d{8}_improve_learner_search_performance_[a-z0-9]{6}$/);
    expect(fp.frontmatter.actor).toBe('claude-code');
    expect(fp.frontmatter.work_type).toBe('implementation_decision');
    expect(fp.frontmatter.status).toBe('completed');
    expect(fp.title).toBe('Improve learner search performance');

    const onDisk = await readFile(fp.filePath, 'utf8');
    const reparsed = parseFootprint(onDisk, fp.filePath);
    expect(reparsed.sections.purpose).toBe('Reduce latency for large organizations.');
    expect(reparsed.sections.decisions).toEqual(['Use cursor pagination.']);
    expect(reparsed.sections.rejectedOptions).toEqual([
      { option: 'Redis cache', reason: 'Consistency risk.' },
    ]);
    expect(reparsed.sections.commandsRun).toEqual(['pnpm test learner-search']);
    expect(reparsed.sections.memoryLearned).toEqual(['Use LearnerQueryService.']);
    expect(reparsed.frontmatter.tags).toEqual(['learner-search', 'performance']);
    expect(reparsed.frontmatter.files_touched).toEqual(['api/learners.ts']);
  });

  it('merges supersedes into related', async () => {
    const fp = await writeFootprint({
      cwd,
      title: 'Replacement decision',
      actor: 'claude-code',
      supersedes: ['fp_20260101_old_x_abc123'],
    });
    expect(fp.frontmatter.related?.supersedes).toEqual(['fp_20260101_old_x_abc123']);
  });

  it('lists footprints sorted by created_at desc', async () => {
    await writeFootprint({
      cwd,
      title: 'First',
      actor: 'a',
      createdAt: '2026-01-01T00:00:00Z',
    });
    await writeFootprint({
      cwd,
      title: 'Second',
      actor: 'a',
      createdAt: '2026-02-01T00:00:00Z',
    });
    const list = await listFootprints(cwd);
    expect(list).toHaveLength(2);
    expect(list[0]!.title).toBe('Second');
    expect(list[1]!.title).toBe('First');
  });
});

describe('writeFootprint secret gate', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeInitedProject();
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  it('throws SecretDetectedError when a prose secret is present and block_on_secret is set', async () => {
    // A fake AWS access key id embedded in prose (content scan should catch it).
    const fakeAws = `AKIA${'A'.repeat(16)}`;
    await expect(
      writeFootprint({
        cwd,
        title: 'Leaky',
        actor: 'a',
        implementationNotes: `The key is ${fakeAws} oops.`,
      }),
    ).rejects.toBeInstanceOf(SecretDetectedError);
  });

  it('reports findings with pattern name and 1-based body line', async () => {
    const fakeGithub = `ghp_${'a'.repeat(36)}`;
    try {
      await writeFootprint({
        cwd,
        title: 'Leaky token',
        actor: 'a',
        implementationNotes: `token ${fakeGithub} here`,
      });
      throw new Error('expected SecretDetectedError');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretDetectedError);
      const findings = (err as SecretDetectedError).findings;
      expect(findings.some((f) => f.name === 'github_pat')).toBe(true);
      expect(findings[0]!.line).toBeGreaterThan(0);
    }
  });

  it('allows override via allowSecret', async () => {
    const fakeAws = `AKIA${'B'.repeat(16)}`;
    const fp = await writeFootprint({
      cwd,
      title: 'Override',
      actor: 'a',
      implementationNotes: `value ${fakeAws}`,
      allowSecret: true,
    });
    expect(fp.frontmatter.id).toBeTruthy();
    const onDisk = await readFile(fp.filePath, 'utf8');
    expect(onDisk).toContain(fakeAws);
  });
});

describe('parseFootprint validation', () => {
  it('rejects missing required frontmatter', () => {
    const raw = `---\nschema_version: 1\nid: fp_x\n---\n\n# T\n`;
    expect(() => parseFootprint(raw, 'x.md')).toThrowError(/required frontmatter field/);
  });

  it('rejects invalid work_type', () => {
    const raw = `---\nschema_version: 1\nid: fp_x\ncreated_at: 2026-01-01T00:00:00Z\nactor: a\nwork_type: nope\nstatus: completed\n---\n\n# T\n`;
    expect(() => parseFootprint(raw, 'x.md')).toThrowError(/invalid work_type/);
  });

  it('rejects unsupported schema_version', () => {
    const raw = `---\nschema_version: 2\nid: fp_x\ncreated_at: 2026-01-01T00:00:00Z\nactor: a\nwork_type: implementation\nstatus: completed\n---\n\n# T\n`;
    expect(() => parseFootprint(raw, 'x.md')).toThrowError(/schema_version/);
  });
});
