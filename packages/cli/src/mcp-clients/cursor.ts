import { existsSync } from 'node:fs';
import path from 'node:path';

import type { ChangeResult } from '@substrata/core';

import { mergeMcpJson, removeMcpJson } from './json-config';
import type { McpClient, McpServerSpec } from './registry';

/**
 * Cursor MCP client. Stores project MCP servers in `.cursor/mcp.json` using the
 * same `mcpServers` map shape as Claude Code. Detected via an existing
 * `.cursor/` directory or `.cursor/mcp.json`.
 */

function cursorMcpPath(cwd: string): string {
  return path.join(cwd, '.cursor', 'mcp.json');
}

export const cursorClient: McpClient = {
  name: 'cursor',
  label: 'Cursor',

  async detect(cwd: string): Promise<boolean> {
    return existsSync(path.join(cwd, '.cursor')) || existsSync(cursorMcpPath(cwd));
  },

  async register(cwd: string, spec: McpServerSpec, dry: boolean = false): Promise<ChangeResult> {
    return mergeMcpJson(cursorMcpPath(cwd), spec, dry);
  },

  async unregister(cwd: string, name: string): Promise<void> {
    removeMcpJson(cursorMcpPath(cwd), name);
  },
};
