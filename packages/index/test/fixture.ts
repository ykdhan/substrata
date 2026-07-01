import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { initProject, memoryDir, writeFootprint } from '@substrata/core';
import type { Footprint, WriteFootprintInput } from '@substrata/core';

/** Create an isolated temp repo with an initialized .substrata directory. */
export async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'substrata-search-'));
  await initProject(dir);
  return dir;
}

/** Convenience wrapper around core's writeFootprint bound to a cwd. */
export function addFootprint(cwd: string, input: WriteFootprintInput): Promise<Footprint> {
  return writeFootprint({ ...input, cwd });
}

/** Write a curated memory file directly under the memory dir. */
export async function addMemory(cwd: string, filename: string, contents: string): Promise<string> {
  const filePath = path.join(memoryDir(cwd), filename);
  await writeFile(filePath, contents, 'utf8');
  return filePath;
}

/**
 * Seed a repo with a representative spread of footprints + a memory doc:
 * - distinct tags, files_touched, statuses
 * - one superseded footprint and one architecture_decision with an old date
 */
export async function seedRepo(cwd: string): Promise<void> {
  await addFootprint(cwd, {
    title: 'Improve learner search performance',
    purpose: 'Reduce latency for large organizations using cursor pagination.',
    actor: 'claude-code',
    workType: 'implementation_decision',
    status: 'completed',
    decisions: [
      'Move learner search pagination to the backend.',
      'Use cursor pagination instead of offset pagination.',
    ],
    rejectedOptions: [
      {
        option: 'Redis cache',
        reason: 'Introduces consistency risk and operational overhead.',
      },
      { option: 'Offset pagination', reason: 'Slower for large organizations.' },
    ],
    implementationNotes: 'Added cursor-based pagination to the learner endpoint.',
    memoryLearned: ['Learner DB access should go through LearnerQueryService.'],
    futureAgentGuidance: 'Avoid Redis cache unless consistency requirements change.',
    filesTouched: ['api/learners.ts', 'services/LearnerQueryService.ts'],
    tags: ['learner-search', 'pagination', 'performance'],
  });

  // A superseded footprint mentioning the same term (Redis) — should be demoted.
  await addFootprint(cwd, {
    title: 'Add Redis cache for learner profiles',
    purpose: 'Cache learner profiles in Redis to speed up lookups.',
    actor: 'claude-code',
    workType: 'implementation_decision',
    status: 'superseded',
    decisions: ['Cache learner profiles in Redis.'],
    filesTouched: ['services/LearnerCache.ts'],
    tags: ['learner-search', 'redis', 'cache'],
  });

  // An architecture_decision with a very old created_at — recency boost halved.
  await addFootprint(cwd, {
    title: 'Adopt event sourcing for billing',
    purpose: 'Use event sourcing to model billing state transitions.',
    actor: 'claude-code',
    workType: 'architecture_decision',
    status: 'completed',
    decisions: ['Model billing as an append-only event log.'],
    filesTouched: ['billing/EventStore.ts'],
    tags: ['billing', 'architecture'],
    createdAt: '2024-01-01T00:00:00.000Z',
  });

  // An unrelated footprint touching a distinct file for filter tests.
  await addFootprint(cwd, {
    title: 'Fix flaky checkout test',
    purpose: 'Stabilize the checkout integration test.',
    actor: 'claude-code',
    workType: 'bug_fix',
    status: 'completed',
    filesTouched: ['checkout/checkout.test.ts'],
    tags: ['checkout', 'testing'],
  });

  await addMemory(
    cwd,
    'learner-search.md',
    `---
schema_version: 1
id: mem_learner_search
type: domain
tags:
  - learner-search
  - conventions
---

# Learner search domain

Learner-related DB access should go through LearnerQueryService.
Avoid client-side filtering for organization-level learner data.

<!-- substrata:entries:start -->
<!-- substrata:entries:end -->
`,
  );
}
