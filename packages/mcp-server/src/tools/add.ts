// substrata_add tool logic. See plan §9 + §12 (secret scan gate).

import {
  SecretDetectedError,
  relativeToCwd,
  supersedeFootprint,
  writeFootprint,
  type WorkType,
} from '@substrata/core';
import { buildIndex } from '@substrata/index';
import { z } from 'zod';

const WORK_TYPES = [
  'implementation',
  'implementation_decision',
  'bug_fix',
  'refactor',
  'investigation',
  'architecture_decision',
  'test_update',
  'documentation',
] as const;

/** Raw zod shape for the substrata_add tool input (plan §9). */
export const addInputShape = {
  title: z.string().describe('Short title of the work.'),
  purpose: z.string().describe('Why the work was done.'),
  actor: z.string().describe('Agent identifier performing the work.'),
  requester: z.string().optional().describe('Who requested the work.'),
  workType: z.enum(WORK_TYPES).optional().describe('Type of work; defaults to implementation.'),
  decisions: z.array(z.string()).optional().describe('Decisions made.'),
  rejectedOptions: z
    .array(z.object({ option: z.string(), reason: z.string() }))
    .optional()
    .describe('Alternatives considered and why they were rejected.'),
  implementationNotes: z.string().optional().describe('Implementation notes.'),
  memoryLearned: z.array(z.string()).optional().describe('Durable facts learned about the repo.'),
  futureAgentGuidance: z.string().optional().describe('Guidance for future agents.'),
  filesTouched: z.array(z.string()).optional().describe('Files changed by the work.'),
  tags: z.array(z.string()).optional().describe('Topic tags.'),
  supersedes: z.array(z.string()).optional().describe('Footprint ids this one replaces.'),
  related: z
    .object({
      commits: z.array(z.string()).optional(),
      prs: z.array(z.union([z.string(), z.number()])).optional(),
      issues: z.array(z.union([z.string(), z.number()])).optional(),
      urls: z.array(z.string()).optional(),
    })
    .optional()
    .describe('Related commits / PRs / issues / urls.'),
} as const;

export type AddInput = {
  title: string;
  purpose: string;
  actor: string;
  requester?: string;
  workType?: (typeof WORK_TYPES)[number];
  decisions?: string[];
  rejectedOptions?: Array<{ option: string; reason: string }>;
  implementationNotes?: string;
  memoryLearned?: string[];
  futureAgentGuidance?: string;
  filesTouched?: string[];
  tags?: string[];
  supersedes?: string[];
  related?: {
    commits?: string[];
    prs?: Array<string | number>;
    issues?: Array<string | number>;
    urls?: string[];
  };
};

export type AddOutcome =
  | { ok: true; id: string; filePath: string }
  | { ok: false; secrets: Array<{ name: string; line: number }> };

/**
 * Write a footprint, honoring the secret-scan gate. On a detected secret we
 * return a structured failure carrying pattern names + line numbers (never the
 * secret value); the caller maps it to an MCP error. On success we apply any
 * supersede links and refresh the index (best effort).
 */
export async function runAdd(input: AddInput, cwd: string): Promise<AddOutcome> {
  try {
    const footprint = await writeFootprint({
      cwd,
      title: input.title,
      purpose: input.purpose,
      actor: input.actor,
      requester: input.requester,
      workType: input.workType as WorkType | undefined,
      decisions: input.decisions,
      rejectedOptions: input.rejectedOptions,
      implementationNotes: input.implementationNotes,
      memoryLearned: input.memoryLearned,
      futureAgentGuidance: input.futureAgentGuidance,
      filesTouched: input.filesTouched,
      tags: input.tags,
      supersedes: input.supersedes,
      related: input.related,
    });

    if (input.supersedes && input.supersedes.length > 0) {
      for (const oldId of input.supersedes) {
        await supersedeFootprint(cwd, oldId, footprint.frontmatter.id);
      }
    }

    // Refresh index so subsequent search/context see the new footprint.
    await buildIndex(cwd).catch(() => {});

    // Return a repo-relative path (consistent with search results; never leak
    // the host's absolute filesystem layout).
    return {
      ok: true,
      id: footprint.frontmatter.id,
      filePath: relativeToCwd(cwd, footprint.filePath),
    };
  } catch (err) {
    if (err instanceof SecretDetectedError) {
      return { ok: false, secrets: err.findings };
    }
    throw err;
  }
}
