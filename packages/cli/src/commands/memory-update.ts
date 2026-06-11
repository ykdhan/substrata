import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  appendMemoryEntries,
  existingEntryIds,
  listFootprints,
  memoryDir,
  type MemoryEntry,
} from '@substrata/core';
import type { Command } from 'commander';

import { promptConfirm, isNonInteractive } from '../wizard/prompts';
import { out, requireConfig, resolveCwd } from '../util';

/**
 * `substrata memory update` — scan footprints, extract `Memory learned` sections,
 * suggest entries, confirm, and append them before the entries:end marker of
 * `.substrata/memory/conventions.md` (created with frontmatter if missing).
 * Idempotent: entries whose source footprint id already appears are skipped
 * (plan §8.10).
 */

const CONVENTIONS_FRONTMATTER = `---
schema_version: 1
id: mem_repo_conventions
type: repo_conventions
tags:
  - conventions
---

# Repo conventions

Curated, durable knowledge agents should read often.

<!-- substrata:entries:start -->
<!-- substrata:entries:end -->
`;

type MemoryUpdateOptions = {
  since?: string;
  yes?: boolean;
};

export function registerMemoryUpdateCommand(program: Command): void {
  const memory = program.command('memory').description('Curated memory utilities');

  memory
    .command('update')
    .description('Suggest and append memory entries from footprints')
    .option('--since <date>', 'Only footprints created on/after this ISO date')
    .option('--yes', 'Append without confirmation')
    .action(async (opts: MemoryUpdateOptions, command: Command) => {
      // `memory` is the parent of `update`; the program is its grandparent.
      const cwd = resolveCwd(command.parent?.parent?.opts());
      await requireConfig(cwd);

      const footprints = await listFootprints(cwd);
      const filtered = opts.since
        ? footprints.filter((fp) => fp.frontmatter.created_at >= opts.since!)
        : footprints;

      const candidates: MemoryEntry[] = [];
      for (const fp of filtered) {
        const learned = fp.sections.memoryLearned ?? [];
        if (learned.length === 0) continue;
        candidates.push({
          sourceId: fp.frontmatter.id,
          lines: learned.map((l) => `- ${l}`),
        });
      }

      if (candidates.length === 0) {
        out.info('No `Memory learned` sections found in the selected footprints.');
        return;
      }

      const filePath = path.join(memoryDir(cwd), 'conventions.md');

      // Compute which entries are genuinely new (idempotent preview).
      const alreadyPresent = existsSync(filePath)
        ? existingEntryIds(await readFile(filePath, 'utf8'))
        : new Set<string>();
      const fresh = candidates.filter((c) => !alreadyPresent.has(c.sourceId));

      if (fresh.length === 0) {
        out.info('All suggested entries are already present. Nothing to do.');
        return;
      }

      out.plain('Suggested memory entries:');
      for (const entry of fresh) {
        out.plain(`  [${entry.sourceId}]`);
        for (const line of entry.lines) out.plain(`    ${line}`);
      }

      const confirmed =
        opts.yes || isNonInteractive()
          ? true
          : await promptConfirm({
              message: `Append ${fresh.length} entr${fresh.length === 1 ? 'y' : 'ies'} to conventions.md?`,
              defaultValue: true,
            });

      if (!confirmed) {
        out.info('Aborted. Nothing written.');
        return;
      }

      if (!existsSync(filePath)) {
        await writeFile(filePath, CONVENTIONS_FRONTMATTER, 'utf8');
      }

      const changed = await appendMemoryEntries(filePath, candidates);
      if (changed) {
        out.ok(`Appended ${fresh.length} memory entr${fresh.length === 1 ? 'y' : 'ies'}.`);
      } else {
        out.info('No new entries appended (already present).');
      }
    });
}
