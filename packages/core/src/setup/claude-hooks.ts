import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '../types';

/**
 * Install (or remove) the Substrata Claude Code lifecycle hooks in
 * `.claude/settings.json` (IMPROVEMENT_PLAN P0 / M1).
 *
 * These hooks close the read/write loop that bare MCP tools leave open:
 *   - SessionStart / UserPromptSubmit -> inject relevant footprint context
 *   - Stop / SubagentStop             -> remind the agent to leave a footprint
 *
 * The write is idempotent and surgical: only entries whose command is a
 * Substrata `hook` invocation are touched, so a user's own hooks survive
 * install, update, and remove untouched.
 */

type HookCommand = { type: 'command'; command: string };
type HookGroup = { matcher?: string; hooks: HookCommand[] };
type ClaudeSettings = {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
};

/** The npx invocation written into each hook. Mirrors the MCP server spec so it
 * resolves the same way regardless of how the CLI was installed. */
const CLI_INVOCATION = ['npx', '-y', 'substrata-cli', 'hook'];

/** Claude Code event name -> the `substrata hook` subcommand it should run. */
const HOOK_EVENTS: Record<string, string[]> = {
  SessionStart: ['session-start'],
  UserPromptSubmit: ['prompt-submit'],
  Stop: ['session-end'],
  SubagentStop: ['session-end', '--subagent'],
};

/** True when a hook group is a Substrata-managed lifecycle hook. */
function isSubstrataGroup(group: HookGroup): boolean {
  return (group.hooks ?? []).some((h) =>
    /\bsubstrata(-cli)?\b[\s\S]*\bhook\b/.test(h.command ?? ''),
  );
}

function settingsPath(cwd: string): string {
  return path.join(cwd, '.claude', 'settings.json');
}

function isSymlink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function readSettings(filePath: string): { settings: ClaudeSettings; existed: boolean } {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { settings: parsed as ClaudeSettings, existed: true };
    }
    return { settings: {}, existed: true };
  } catch {
    return { settings: {}, existed: false };
  }
}

function buildGroup(subcommand: string[]): HookGroup {
  return { hooks: [{ type: 'command', command: [...CLI_INVOCATION, ...subcommand].join(' ') }] };
}

/** True when at least one Substrata-managed lifecycle hook is present. */
export function claudeHooksInstalled(cwd: string): boolean {
  const { settings } = readSettings(settingsPath(cwd));
  const hooks = settings.hooks ?? {};
  return Object.values(hooks).some((groups) => (groups ?? []).some(isSubstrataGroup));
}

/**
 * Install or remove the Substrata lifecycle hooks. With `remove: true` the
 * managed entries are stripped and nothing is added. Idempotent: re-running with
 * the same intent reports `skip`.
 */
export function installClaudeHooks(
  cwd: string,
  dry: boolean = false,
  opts: { remove?: boolean } = {},
): ChangeResult {
  const filePath = settingsPath(cwd);
  if (isSymlink(filePath)) {
    return {
      path: filePath,
      action: 'skip',
      description: 'refused: .claude/settings.json is a symlink',
    };
  }

  const { settings, existed } = readSettings(filePath);
  const before = JSON.stringify(settings);

  const hooks: Record<string, HookGroup[]> = { ...(settings.hooks ?? {}) };
  for (const [event, subcommand] of Object.entries(HOOK_EVENTS)) {
    // Drop any previously-managed entry so a drifted command is replaced wholesale.
    const others = (hooks[event] ?? []).filter((g) => !isSubstrataGroup(g));
    const next = opts.remove ? others : [...others, buildGroup(subcommand)];
    if (next.length > 0) hooks[event] = next;
    else delete hooks[event];
  }

  const nextSettings: ClaudeSettings = { ...settings };
  if (Object.keys(hooks).length > 0) nextSettings.hooks = hooks;
  else delete nextSettings.hooks;

  const after = JSON.stringify(nextSettings);
  if (after === before) {
    return {
      path: filePath,
      action: 'skip',
      description: opts.remove
        ? 'Claude Code hooks not installed'
        : 'Claude Code hooks already installed',
    };
  }

  const contents = `${JSON.stringify(nextSettings, null, 2)}\n`;
  if (!dry) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents, 'utf8');
  }

  return {
    path: filePath,
    action: !existed ? 'create' : 'update',
    description: opts.remove
      ? 'remove Substrata Claude Code lifecycle hooks'
      : 'install Substrata Claude Code lifecycle hooks',
    contents,
  };
}
