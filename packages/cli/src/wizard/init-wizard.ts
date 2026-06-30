import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  configPath,
  initProject,
  renderConfig,
  type AttributionEnv,
  type ChangeResult,
} from '@substrata/core';
import {
  ensureCliDependency,
  ensureGitattributes,
  ensureGitignore,
  installSecretHook,
  upsertAgentsMd,
  upsertEditorRules,
  writeShellEnv,
  type StorageSharing,
} from '@substrata/editor-integrations';
import { installClaudeHooks } from '@substrata/hooks';
import pc from 'picocolors';
import { parseDocument, type Document } from 'yaml';

import { configureMergeDriver } from '../merge-driver';

import pkg from '../../package.json';

import {
  detectMcpClients,
  getMcpClient,
  SUBSTRATA_MCP_SPEC,
  type McpClient,
} from '../mcp-clients/registry';
import { git, isGitRepo, out } from '../util';

import { promptConfirm, promptMultiselect, promptText } from './prompts';

/**
 * The `init` setup wizard (plan §8.1). Collects answers, prints a change plan,
 * and applies nothing until one final confirmation. Idempotent: re-running enters
 * update mode (markers replaced in place; gitignore/MCP de-duplicated).
 */

export type InitFlags = {
  yes?: boolean;
  project?: string;
  actor?: string;
  model?: string;
  requester?: string;
  env?: boolean; // --no-env => false
  agentsMd?: boolean; // --no-agents-md => false
  editorRules?: boolean; // --no-editor-rules => false
  mcp?: boolean; // --no-mcp => false
  mcpClient?: string[];
  gitignore?: boolean; // --no-gitignore => false
  redact?: boolean; // --no-redact => false
  withHook?: boolean;
  claudeHooks?: boolean; // --no-claude-hooks => false
  index?: boolean; // --no-index => false
  sharing?: string; // --sharing <local|shared>
  cliDep?: boolean; // --no-cli-dep => false
  printConfig?: boolean;
};

type Answers = {
  projectName: string;
  attribution: AttributionEnv;
  writeEnv: boolean;
  rcPath: string;
  redact: boolean;
  withHook: boolean;
  installClaudeHooks: boolean;
  writeAgentsMd: boolean;
  writeEditorRules: boolean;
  writeGitignore: boolean;
  sharing: StorageSharing;
  addCliDep: boolean;
  mcpClients: McpClient[];
};

/** Read storage.sharing from an existing config.yml, if present (best-effort). */
function existingSharing(cwd: string): StorageSharing | undefined {
  const file = path.join(cwd, '.substrata', 'config.yml');
  try {
    const raw = readFileSync(file, 'utf8');
    return /^\s*sharing:\s*shared\s*$/m.test(raw) ? 'shared' : 'local';
  } catch {
    return undefined;
  }
}

/**
 * Set `storage.sharing` in an existing config.yml via the YAML AST, preserving
 * comments/formatting and handling quoted or missing values without risking a
 * duplicate key. Leaves a fresh config effectively untouched (initProject already
 * wrote the right value). Best-effort: a malformed file is left alone.
 */
function syncConfigSharing(cwd: string, sharing: StorageSharing): void {
  const file = configPath(cwd);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  let doc: Document;
  try {
    doc = parseDocument(raw);
  } catch {
    return;
  }
  if (doc.errors.length > 0) return;
  doc.setIn(['storage', 'sharing'], sharing);
  const next = doc.toString();
  if (next !== raw) writeFileSync(file, next, 'utf8');
}

/** Resolve the index-sharing mode from flags / existing config / a prompt. */
async function resolveSharing(cwd: string, flags: InitFlags): Promise<StorageSharing> {
  if (flags.sharing === 'shared' || flags.sharing === 'local') return flags.sharing;
  const current = existingSharing(cwd);
  if (flags.yes) return current ?? 'local';
  const shared = await promptConfirm({
    message:
      'Share the index DB with your team (commit it to the repo)? Otherwise it stays local + gitignored.',
    defaultValue: current === 'shared',
  });
  return shared ? 'shared' : 'local';
}

/** Detect the user's shell rc file from $SHELL, defaulting to ~/.zshrc. */
function detectShellRc(): string {
  const shell = process.env.SHELL ?? '';
  const home = homedir();
  if (shell.includes('bash')) return path.join(home, '.bashrc');
  return path.join(home, '.zshrc');
}

/** Default project name: package.json "name", else the folder basename. */
function defaultProjectName(cwd: string): string {
  const pkgPath = path.join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
      if (pkg.name && typeof pkg.name === 'string') {
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    } catch {
      // ignore malformed package.json
    }
  }
  return path.basename(path.resolve(cwd));
}

/** Step 0: preflight — git repo check (offer git init), MCP client detection. */
async function preflight(cwd: string, flags: InitFlags): Promise<void> {
  if (!(await isGitRepo(cwd))) {
    const doInit = await promptConfirm({
      message: 'This is not a Git repository. Run `git init`?',
      defaultValue: true,
    });
    if (doInit) {
      const result = await git(cwd, ['init']);
      if (result !== null) out.ok('Initialized a Git repository.');
      else out.warn('Could not run `git init`; continuing without Git.');
    }
  }
  void flags;
}

/** Resolve the set of MCP clients to register, honoring --mcp-client / --no-mcp. */
async function resolveMcpClients(cwd: string, flags: InitFlags): Promise<McpClient[]> {
  if (flags.mcp === false) return [];

  if (flags.mcpClient && flags.mcpClient.length > 0) {
    const chosen: McpClient[] = [];
    for (const name of flags.mcpClient) {
      const client = getMcpClient(name);
      if (client) chosen.push(client);
      else out.warn(`Unknown MCP client "${name}" — skipping.`);
    }
    return chosen;
  }

  const detected = await detectMcpClients(cwd);
  if (detected.length === 0) return [];

  return promptMultiselect<McpClient>({
    message: 'Register the Substrata MCP server with which clients?',
    choices: detected.map((c) => ({ value: c, label: c.label })),
    defaultValues: detected,
  });
}

/** Collect all wizard answers (no writes). */
async function collectAnswers(cwd: string, flags: InitFlags): Promise<Answers> {
  const projectName =
    flags.project ??
    (await promptText({
      message: 'Project name',
      defaultValue: defaultProjectName(cwd),
    }));

  // Agent attribution.
  const actor = await promptText({
    message: 'Default actor (agent id)',
    defaultValue: flags.actor ?? 'unknown-agent',
  });
  const model =
    flags.model ??
    (await promptText({ message: 'Default agent model (optional)', defaultValue: '' }));
  const gitEmail = (await git(cwd, ['config', 'user.email'])) ?? '';
  const requester =
    flags.requester ??
    (await promptText({ message: 'Default requester (optional)', defaultValue: gitEmail }));

  const attribution: AttributionEnv = {
    actor: actor || undefined,
    model: model || undefined,
    requester: requester || undefined,
  };

  const writeEnv =
    flags.env === false
      ? false
      : await promptConfirm({
          message: 'Persist attribution env vars to your shell rc?',
          defaultValue: true,
        });

  const redact =
    flags.redact === false
      ? false
      : await promptConfirm({
          message: 'Enable security redaction + content scan?',
          defaultValue: true,
        });

  const withHook =
    flags.withHook === true
      ? true
      : await promptConfirm({
          message: 'Install the pre-commit secret hook?',
          defaultValue: false,
        });

  const writeAgentsMd =
    flags.agentsMd === false
      ? false
      : await promptConfirm({
          message: 'Add the Substrata section to AGENTS.md?',
          defaultValue: true,
        });

  const writeEditorRules =
    flags.editorRules === false
      ? false
      : await promptConfirm({
          message: 'Generate per-editor rules (CLAUDE.md, GEMINI.md, .cursor/rules)?',
          defaultValue: true,
        });

  const writeGitignore = flags.gitignore !== false;
  const sharing = await resolveSharing(cwd, flags);
  const addCliDep = flags.cliDep !== false;

  const mcpClients = await resolveMcpClients(cwd, flags);

  // Default the lifecycle-hooks prompt on when Claude Code is in the mix.
  const claudeDetected = mcpClients.some((c) => c.name === 'claude');
  const installHooks =
    flags.claudeHooks === false
      ? false
      : flags.claudeHooks === true
        ? true
        : await promptConfirm({
            message:
              'Install Claude Code lifecycle hooks (auto-inject memory + footprint reminder)?',
            defaultValue: claudeDetected,
          });

  return {
    projectName,
    attribution,
    writeEnv,
    rcPath: detectShellRc(),
    redact,
    withHook,
    installClaudeHooks: installHooks,
    writeAgentsMd,
    writeEditorRules,
    writeGitignore,
    sharing,
    addCliDep,
    mcpClients,
  };
}

/** Build the full change plan as dry-run ChangeResults (no writes). */
async function buildPlan(cwd: string, answers: Answers): Promise<ChangeResult[]> {
  const changes: ChangeResult[] = [];

  // Scaffold: simulate by checking what initProject would create.
  // initProject itself is idempotent (skips existing), but it writes; for the
  // plan we describe the scaffold as a single logical step.
  changes.push({
    path: path.join(cwd, '.substrata'),
    action: existsSync(path.join(cwd, '.substrata', 'config.yml')) ? 'skip' : 'create',
    description: `Substrata scaffold (config, README, footprints, memory, templates) — ${answers.sharing} index`,
  });

  if (answers.writeGitignore) {
    changes.push(ensureGitignore(cwd, true, { sharing: answers.sharing }));
  }

  if (answers.sharing === 'shared') {
    changes.push(ensureGitattributes(cwd, true));
  }

  if (answers.addCliDep) {
    changes.push(ensureCliDependency(cwd, pkg.version, true));
  }

  if (
    answers.writeEnv &&
    (answers.attribution.actor || answers.attribution.model || answers.attribution.requester)
  ) {
    changes.push(writeShellEnv(answers.rcPath, answers.attribution, true));
  }

  if (answers.writeAgentsMd) {
    changes.push(upsertAgentsMd(cwd, true));
  }

  if (answers.writeEditorRules) {
    changes.push(...upsertEditorRules(cwd, true));
  }

  if (answers.withHook) {
    changes.push(installSecretHook(cwd, true));
  }

  if (answers.installClaudeHooks) {
    changes.push(installClaudeHooks(cwd, true));
  }

  for (const client of answers.mcpClients) {
    changes.push(await client.register(cwd, SUBSTRATA_MCP_SPEC, true));
  }

  return changes;
}

/** Apply the plan for real (idempotent writers). Returns applied changes. */
async function applyPlan(cwd: string, answers: Answers): Promise<ChangeResult[]> {
  const applied: ChangeResult[] = [];

  applied.push(
    ...(await initProject(cwd, { projectName: answers.projectName, sharing: answers.sharing })),
  );
  // initProject never overwrites an existing config.yml, so in update mode (or on
  // a legacy config) sync storage.sharing to the resolved mode surgically.
  syncConfigSharing(cwd, answers.sharing);

  if (answers.writeGitignore) {
    applied.push(ensureGitignore(cwd, false, { sharing: answers.sharing }));
  }

  if (answers.sharing === 'shared') {
    applied.push(ensureGitattributes(cwd, false));
    // Register the local git merge driver so committed-DB conflicts auto-rebuild.
    await configureMergeDriver(cwd);
  }

  if (answers.addCliDep) {
    applied.push(ensureCliDependency(cwd, pkg.version, false));
  }

  if (
    answers.writeEnv &&
    (answers.attribution.actor || answers.attribution.model || answers.attribution.requester)
  ) {
    applied.push(writeShellEnv(answers.rcPath, answers.attribution, false));
  } else if (!answers.writeEnv) {
    printEnvSnippet(answers.attribution);
  }

  if (answers.writeAgentsMd) {
    applied.push(upsertAgentsMd(cwd, false));
  }

  if (answers.writeEditorRules) {
    applied.push(...upsertEditorRules(cwd, false));
  }

  if (answers.withHook) {
    applied.push(installSecretHook(cwd, false));
  }

  if (answers.installClaudeHooks) {
    applied.push(installClaudeHooks(cwd, false));
  }

  for (const client of answers.mcpClients) {
    const result = await client.register(cwd, SUBSTRATA_MCP_SPEC, false);
    applied.push(result);
    // Windsurf etc. return a skip with a printable snippet in the description.
    if (result.action === 'skip' && result.description.includes('\n')) {
      out.info(`${client.label}: ${result.description}`);
    }
  }

  return applied;
}

/** Print the export snippet when env persistence is declined (plan §8.1 step 2). */
function printEnvSnippet(attribution: AttributionEnv): void {
  const lines: string[] = [];
  if (attribution.actor) lines.push(`export SUBSTRATA_ACTOR="${attribution.actor}"`);
  if (attribution.model) lines.push(`export SUBSTRATA_MODEL="${attribution.model}"`);
  if (attribution.requester) lines.push(`export SUBSTRATA_REQUESTER="${attribution.requester}"`);
  if (lines.length === 0) return;
  out.info('Add these to your shell rc to attribute footprints:');
  out.plain(lines.map((l) => `  ${l}`).join('\n'));
}

/** Render the resolved config.yml without writing (for --print-config). */
export function printResolvedConfig(cwd: string, flags: InitFlags): void {
  const name = flags.project ?? defaultProjectName(cwd);
  const sharing: StorageSharing = flags.sharing === 'shared' ? 'shared' : 'local';
  out.plain(renderConfig(name, { sharing }));
}

export type WizardResult = {
  applied: ChangeResult[];
  aborted: boolean;
};

/** Run the full init wizard. Returns whether the user aborted. */
export async function runInitWizard(cwd: string, flags: InitFlags): Promise<WizardResult> {
  const updateMode = existsSync(path.join(cwd, '.substrata', 'config.yml'));
  if (updateMode) {
    out.info('Existing .substrata detected — running in update mode.');
  }

  await preflight(cwd, flags);
  const answers = await collectAnswers(cwd, flags);

  const plan = await buildPlan(cwd, answers);
  out.plain(pc.bold('\nPlanned changes:'));
  out.plain(
    plan
      .map((c) => {
        const label =
          c.action === 'create'
            ? pc.green('CREATE')
            : c.action === 'update'
              ? pc.yellow('UPDATE')
              : pc.dim('SKIP  ');
        return `  ${label}  ${c.path}${c.description ? pc.dim(` — ${c.description.split('\n')[0]}`) : ''}`;
      })
      .join('\n'),
  );
  out.plain('');

  const confirmed = await promptConfirm({ message: 'Apply these changes?', defaultValue: true });
  if (!confirmed) {
    out.info('Aborted. Nothing was written.');
    return { applied: [], aborted: true };
  }

  const applied = await applyPlan(cwd, answers);
  out.ok('Substrata setup applied.');

  if (answers.writeEnv) {
    out.info(`Run \`source ${answers.rcPath}\` to load attribution env vars.`);
  }

  return { applied, aborted: false };
}
