import { lstatSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '@substrata/core';

import type { McpServerSpec } from './registry';

/**
 * Shared helper for clients that store MCP servers in a JSON file under an
 * `mcpServers` map (Claude Code `.mcp.json`, Cursor `.cursor/mcp.json`). The
 * write is idempotent: remove-then-add the named entry, preserving other keys.
 */

type McpJson = {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  [key: string]: unknown;
};

function isSymlink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function readJson(filePath: string): McpJson | null {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as McpJson) : {};
  } catch {
    return null;
  }
}

/** Whether the existing config already contains the spec entry exactly. */
function entryMatches(existing: McpJson | null, spec: McpServerSpec): boolean {
  const entry = existing?.mcpServers?.[spec.name];
  if (!entry) return false;
  return (
    entry.command === spec.command && JSON.stringify(entry.args ?? []) === JSON.stringify(spec.args)
  );
}

/**
 * Merge the Substrata MCP server into a JSON config file at `filePath`.
 * Remove-then-add semantics keep the result idempotent across reruns.
 */
export function mergeMcpJson(
  filePath: string,
  spec: McpServerSpec,
  dry: boolean = false,
): ChangeResult {
  // Refuse to write through a symlink: a repo-shipped link could redirect the
  // merge into a file outside the repo.
  if (isSymlink(filePath)) {
    return {
      path: filePath,
      action: 'skip',
      description: `refused: ${path.basename(filePath)} is a symlink`,
    };
  }
  const existing = readJson(filePath);

  if (entryMatches(existing, spec)) {
    return { path: filePath, action: 'skip', description: 'MCP entry already current' };
  }

  const base: McpJson = existing ?? {};
  const servers = { ...(base.mcpServers ?? {}) };
  // Remove-then-add so a drifted entry is replaced wholesale.
  delete servers[spec.name];
  servers[spec.name] = { command: spec.command, args: spec.args };

  const next: McpJson = { ...base, mcpServers: servers };
  const contents = `${JSON.stringify(next, null, 2)}\n`;

  if (!dry) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents, 'utf8');
  }

  return {
    path: filePath,
    action: existing === null ? 'create' : 'update',
    description: `register Substrata MCP server (${spec.name})`,
    contents,
  };
}

/** Remove the named MCP entry from a JSON config file (idempotent). */
export function removeMcpJson(filePath: string, name: string): void {
  const existing = readJson(filePath);
  if (!existing?.mcpServers?.[name]) return;
  const servers = { ...existing.mcpServers };
  delete servers[name];
  const next: McpJson = { ...existing, mcpServers: servers };
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}
