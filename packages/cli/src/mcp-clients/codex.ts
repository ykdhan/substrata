import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { ChangeResult } from '@substrata/core';

import type { McpClient, McpServerSpec } from './registry';

/**
 * Codex CLI MCP client. Codex stores MCP servers in TOML at the per-user global
 * `~/.codex/config.toml` (it has no project-local equivalent), so registration
 * edits that file via a marker-delimited block — the same managed-block strategy
 * `writeShellEnv` uses for shell rc files — keeping the write idempotent,
 * removable, and non-destructive to the user's other Codex config. Detected via
 * an existing `~/.codex/` directory.
 *
 * `~/.codex/` honors $HOME (via os.homedir()), so tests point HOME at a temp dir
 * rather than touching the real config.
 */

const BEGIN = '# >>> substrata >>>';
const END = '# <<< substrata <<<';

function codexConfigPath(): string {
  return path.join(homedir(), '.codex', 'config.toml');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A valid TOML table for the Substrata server, wrapped in managed markers. */
function renderTomlBlock(spec: McpServerSpec): string {
  const args = spec.args.map((a) => JSON.stringify(a)).join(', ');
  return [
    BEGIN,
    `[mcp_servers.${spec.name}]`,
    `command = ${JSON.stringify(spec.command)}`,
    `args = [${args}]`,
    END,
  ].join('\n');
}

export const codexClient: McpClient = {
  name: 'codex',
  label: 'Codex',

  async detect(): Promise<boolean> {
    return existsSync(path.join(homedir(), '.codex'));
  },

  async register(_cwd: string, spec: McpServerSpec, dry: boolean = false): Promise<ChangeResult> {
    const file = codexConfigPath();

    // Refuse to write through a symlink (could redirect outside ~/.codex).
    try {
      if (lstatSync(file).isSymbolicLink()) {
        return { path: file, action: 'skip', description: 'refused: config.toml is a symlink' };
      }
    } catch {
      // file absent — treated as create below.
    }

    const block = renderTomlBlock(spec);
    let existing: string | null;
    try {
      existing = readFileSync(file, 'utf8');
    } catch {
      existing = null;
    }

    const markerRe = new RegExp(`${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}`, 'm');

    let next: string;
    let action: ChangeResult['action'];
    if (existing === null) {
      next = `${block}\n`;
      action = 'create';
    } else if (markerRe.test(existing)) {
      const replaced = existing.replace(markerRe, block);
      if (replaced === existing) {
        return { path: file, action: 'skip', description: 'Codex MCP block already current' };
      }
      next = replaced;
      action = 'update';
    } else {
      const sep = existing.endsWith('\n') ? '' : '\n';
      next = `${existing}${sep}\n${block}\n`;
      action = 'update';
    }

    if (!dry) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, next, 'utf8');
    }

    return {
      path: file,
      action,
      description: 'register Substrata MCP server (global ~/.codex/config.toml)',
      contents: next,
    };
  },

  async unregister(): Promise<void> {
    const file = codexConfigPath();
    let existing: string;
    try {
      existing = readFileSync(file, 'utf8');
    } catch {
      return;
    }
    const markerRe = new RegExp(
      `\\n?${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}\\n?`,
      'm',
    );
    if (!markerRe.test(existing)) return;
    writeFileSync(file, existing.replace(markerRe, '\n'), 'utf8');
  },
};
