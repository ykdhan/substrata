import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { renderConfig } from './config';
import { configPath, footprintsDir, memoryDir, substrataDir, templatesDir } from './paths';
import type { ChangeResult, InitOptions } from './types';

/**
 * Project scaffolding for `substrata init`. Idempotent: existing files are never
 * overwritten. See plan §8.1 ("Created on apply") and §14.
 */

const README_CONTENTS = `# Substrata

This directory holds shared agent memory for this repository.

- \`footprints/\` — committed source-of-truth records of agent-assisted work.
- \`memory/\` — curated, durable repo knowledge agents should read often.
- \`templates/\` — templates used when creating footprints and memory files.
- \`config.yml\` — Substrata configuration (see the docs).
- \`index/\` and \`cache/\` — generated, gitignored; safe to delete and rebuild.

Footprints and memory files are committed. Do not store secrets, credentials,
private keys, tokens, or sensitive user data here.
`;

const FOOTPRINT_TEMPLATE = `---
schema_version: 1
id: fp_YYYYMMDD_slug_suffix
created_at: 2026-01-01T00:00:00Z
actor: unknown-agent
work_type: implementation
status: completed
---

# Title

## Purpose

Why this work was done.

## Decisions

- Decision one.

## Rejected options

### Option name

Why it was rejected.

## Implementation notes

What was changed.

## Commands run

\`\`\`bash
pnpm test
\`\`\`

## Memory learned

- Something durable about this repo.

## Future agent guidance

What a future agent should check before changing this area.
`;

const MEMORY_TEMPLATE = `---
schema_version: 1
id: mem_example
type: repo_conventions
tags:
  - conventions
---

# Memory title

## Section

- Durable note one.

<!-- substrata:entries:start -->
<!-- substrata:entries:end -->
`;

type FileSpec = { absPath: string; contents: string };
type DirSpec = string;

async function exists(p: string): Promise<boolean> {
  const { stat } = await import('node:fs/promises');
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the .substrata scaffold. Never overwrites existing files/dirs.
 * Returns the list of changes applied (create/skip per path).
 */
export async function initProject(cwd: string, options: InitOptions = {}): Promise<ChangeResult[]> {
  const projectName = options.projectName ?? path.basename(path.resolve(cwd));

  const dirs: DirSpec[] = [
    substrataDir(cwd),
    footprintsDir(cwd),
    memoryDir(cwd),
    templatesDir(cwd),
  ];

  const files: FileSpec[] = [
    { absPath: configPath(cwd), contents: renderConfig(projectName, { sharing: options.sharing }) },
    { absPath: path.join(substrataDir(cwd), 'README.md'), contents: README_CONTENTS },
    { absPath: path.join(templatesDir(cwd), 'footprint.md'), contents: FOOTPRINT_TEMPLATE },
    { absPath: path.join(templatesDir(cwd), 'memory.md'), contents: MEMORY_TEMPLATE },
  ];

  const changes: ChangeResult[] = [];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  for (const file of files) {
    if (await exists(file.absPath)) {
      changes.push({
        path: file.absPath,
        action: 'skip',
        description: 'already exists',
      });
      continue;
    }
    await writeFile(file.absPath, file.contents, 'utf8');
    changes.push({
      path: file.absPath,
      action: 'create',
      description: 'created',
      contents: file.contents,
    });
  }

  return changes;
}
