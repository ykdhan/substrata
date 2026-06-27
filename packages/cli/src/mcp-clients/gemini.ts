import { existsSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '@substrata/core';

import { mergeMcpJson, removeMcpJson } from './json-config';
import type { McpClient, McpServerSpec } from './registry';

/**
 * Gemini CLI MCP client. Gemini reads project MCP servers from
 * `.gemini/settings.json` using the same `mcpServers` map shape as Claude Code
 * and Cursor, so registration is project-local (no homedir writes) and reuses
 * the shared JSON merge. Detected via an existing `.gemini/` directory.
 */

function geminiMcpPath(cwd: string): string {
  return path.join(cwd, '.gemini', 'settings.json');
}

export const geminiClient: McpClient = {
  name: 'gemini',
  label: 'Gemini CLI',

  async detect(cwd: string): Promise<boolean> {
    return existsSync(path.join(cwd, '.gemini')) || existsSync(geminiMcpPath(cwd));
  },

  async register(cwd: string, spec: McpServerSpec, dry: boolean = false): Promise<ChangeResult> {
    return mergeMcpJson(geminiMcpPath(cwd), spec, dry);
  },

  async unregister(cwd: string, name: string): Promise<void> {
    removeMcpJson(geminiMcpPath(cwd), name);
  },
};
