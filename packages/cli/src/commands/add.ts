import {
  SecretDetectedError,
  supersedeFootprint,
  writeFootprint,
  type RejectedOption,
  type WorkType,
  type WriteFootprintInput,
} from '@substrata/core';
import type { Command } from 'commander';

import { promptText, isNonInteractive } from '../wizard/prompts';
import {
  CliError,
  collectGitContext,
  out,
  requireConfig,
  resolveAttribution,
  resolveCwd,
} from '../util';

/**
 * `substrata add` — create a footprint, interactive or non-interactive. Resolves
 * actor/model/requester by precedence (plan §8.2), optionally enriches from Git
 * (`--from-git`), runs the secret scan inside core (catching SecretDetectedError
 * to print the §12 refusal), and prints the §12 commit reminder on success.
 */

const SECURITY_REMINDER =
  'Reminder: Substrata files are intended to be committed.\n' +
  'Do not include secrets, credentials, or sensitive user data.';

type AddOptions = {
  title?: string;
  purpose?: string;
  actor?: string;
  requester?: string;
  model?: string;
  files?: string;
  tag?: string[];
  workType?: string;
  decision?: string[];
  rejected?: string[];
  notes?: string;
  memory?: string[];
  guidance?: string;
  template?: string;
  supersedes?: string;
  allowSecret?: boolean;
  fromGit?: boolean;
};

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse a `--rejected "option:reason"` value into a structured RejectedOption. */
function parseRejected(values: string[] | undefined): RejectedOption[] {
  if (!values) return [];
  return values.map((v) => {
    const idx = v.indexOf(':');
    if (idx === -1) return { option: v.trim(), reason: '' };
    return { option: v.slice(0, idx).trim(), reason: v.slice(idx + 1).trim() };
  });
}

const VALID_WORK_TYPES: ReadonlySet<string> = new Set<WorkType>([
  'implementation',
  'implementation_decision',
  'bug_fix',
  'refactor',
  'investigation',
  'architecture_decision',
  'test_update',
  'documentation',
]);

export function registerAddCommand(program: Command): void {
  program
    .command('add')
    .description('Create a new footprint')
    .option('--title <title>', 'Footprint title')
    .option('--purpose <text>', 'Why this work was done')
    .option('--actor <id>', 'Agent that performed the work')
    .option('--requester <id>', 'Who requested the work')
    .option('--model <id>', 'Agent model identifier')
    .option('--files <csv>', 'Comma-separated files touched')
    .option('--tag <tag>', 'Tag (repeatable)', collect, [])
    .option('--work-type <type>', 'Footprint work type')
    .option('--decision <text>', 'Decision made (repeatable)', collect, [])
    .option('--rejected <option:reason>', 'Rejected option (repeatable)', collect, [])
    .option('--notes <text>', 'Implementation notes')
    .option('--memory <text>', 'Memory learned (repeatable)', collect, [])
    .option('--guidance <text>', 'Future agent guidance')
    .option('--template <type>', 'Work type template to seed the footprint')
    .option('--supersedes <id>', 'Mark this footprint as superseding an old one')
    .option('--allow-secret', 'Write even if a secret is detected (NOT recommended)')
    .option('--from-git', 'Populate branch/files/commit from Git')
    .action(async (opts: AddOptions, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      const config = await requireConfig(cwd);

      const attribution = await resolveAttribution(cwd, config, {
        actor: opts.actor,
        model: opts.model,
        requester: opts.requester,
      });

      // Title: required in non-interactive mode; prompted otherwise.
      let title = opts.title;
      if (!title) {
        if (isNonInteractive()) {
          throw new CliError('`--title` is required in non-interactive mode.');
        }
        title = await promptText({ message: 'Title', defaultValue: '' });
        if (!title.trim()) throw new CliError('A title is required.');
      }

      const purpose =
        opts.purpose ??
        (isNonInteractive()
          ? undefined
          : (await promptText({ message: 'Purpose', defaultValue: '' })) || undefined);

      const workTypeRaw = opts.workType ?? opts.template;
      if (workTypeRaw && !VALID_WORK_TYPES.has(workTypeRaw)) {
        throw new CliError(
          `Invalid work type "${workTypeRaw}". Valid: ${Array.from(VALID_WORK_TYPES).join(', ')}.`,
        );
      }
      const workType = workTypeRaw as WorkType | undefined;

      let filesTouched = splitCsv(opts.files);
      let repoBranch: string | undefined;
      let commits: string[] | undefined;

      if (opts.fromGit) {
        const ctx = await collectGitContext(cwd);
        repoBranch = ctx.branch;
        if (ctx.files.length > 0) {
          filesTouched = Array.from(new Set([...filesTouched, ...ctx.files]));
        }
        if (ctx.commit) commits = [ctx.commit];
      }

      const supersedes = opts.supersedes ? [opts.supersedes] : undefined;

      const input: WriteFootprintInput & { cwd: string } = {
        cwd,
        title,
        purpose,
        actor: attribution.actor,
        requester: attribution.requester,
        agentModel: attribution.model,
        workType,
        decisions: opts.decision && opts.decision.length > 0 ? opts.decision : undefined,
        rejectedOptions:
          opts.rejected && opts.rejected.length > 0 ? parseRejected(opts.rejected) : undefined,
        implementationNotes: opts.notes,
        memoryLearned: opts.memory && opts.memory.length > 0 ? opts.memory : undefined,
        futureAgentGuidance: opts.guidance,
        filesTouched: filesTouched.length > 0 ? filesTouched : undefined,
        tags: opts.tag && opts.tag.length > 0 ? opts.tag : undefined,
        repo: repoBranch ? { branch: repoBranch } : undefined,
        related: commits ? { commits } : undefined,
        supersedes,
        allowSecret: opts.allowSecret,
      };

      let footprint;
      try {
        footprint = await writeFootprint(input);
      } catch (err) {
        if (err instanceof SecretDetectedError) {
          // §12 refusal: print pattern names + line numbers, NEVER values.
          const detail = err.findings.map((f) => `  - ${f.name} at body line ${f.line}`).join('\n');
          throw new CliError(
            `Refusing to write footprint: ${err.findings.length} potential secret(s) detected\n${detail}\n` +
              '  Redact these or pass --allow-secret to override (NOT recommended — footprints are committed).',
          );
        }
        throw err;
      }

      // If superseding, also flip the old footprint's status/links.
      if (opts.supersedes) {
        await supersedeFootprint(cwd, opts.supersedes, footprint.frontmatter.id);
      }

      out.ok(`Footprint written: ${footprint.frontmatter.id}`);
      out.plain(`  ${footprint.filePath}`);
      out.warn(SECURITY_REMINDER);
    });
}
