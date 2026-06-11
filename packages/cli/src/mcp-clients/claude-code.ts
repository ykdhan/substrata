import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { ChangeResult } from '@substrata/core';

import { mergeMcpJson, removeMcpJson } from './json-config';
import type { McpClient, McpServerSpec } from './registry';

/**
 * Claude Code MCP client. Detected via the `claude` binary on PATH OR an existing
 * project `.mcp.json`. Registration writes `.mcp.json` directly (rather than
 * shelling to `claude mcp add`) so it is deterministic and testable.
 */

const execFileAsync = promisify(execFile);

function mcpJsonPath(cwd: string): string {
  return path.join(cwd, '.mcp.json');
}

async function hasClaudeBinary(): Promise<boolean> {
  try {
    await execFileAsync('which', ['claude']);
    return true;
  } catch {
    return false;
  }
}

export const claudeCodeClient: McpClient = {
  name: 'claude',
  label: 'Claude Code',

  async detect(cwd: string): Promise<boolean> {
    if (existsSync(mcpJsonPath(cwd))) return true;
    return hasClaudeBinary();
  },

  async register(cwd: string, spec: McpServerSpec, dry: boolean = false): Promise<ChangeResult> {
    return mergeMcpJson(mcpJsonPath(cwd), spec, dry);
  },

  async unregister(cwd: string, name: string): Promise<void> {
    removeMcpJson(mcpJsonPath(cwd), name);
  },
};
