import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { ChangeResult } from '@substrata/core';

import type { McpClient, McpServerSpec } from './registry';

/**
 * Windsurf MCP client. Windsurf's MCP config is global per-user
 * (`~/.codeium/windsurf/mcp_config.json`), so registration does NOT edit the
 * user's homedir. Instead it returns a `skip` ChangeResult whose description is a
 * printable snippet + path the user can apply manually.
 */

function windsurfConfigPath(): string {
  return path.join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
}

function snippet(spec: McpServerSpec): string {
  const block = {
    mcpServers: {
      [spec.name]: { command: spec.command, args: spec.args },
    },
  };
  return `${windsurfConfigPath()}\n${JSON.stringify(block, null, 2)}`;
}

export const windsurfClient: McpClient = {
  name: 'windsurf',
  label: 'Windsurf',

  async detect(): Promise<boolean> {
    return existsSync(path.join(homedir(), '.codeium', 'windsurf'));
  },

  async register(_cwd: string, spec: McpServerSpec): Promise<ChangeResult> {
    // Global config — never write into the user's homedir; print a snippet.
    return {
      path: windsurfConfigPath(),
      action: 'skip',
      description: `add manually (global config):\n${snippet(spec)}`,
    };
  },

  async unregister(): Promise<void> {
    // No-op: Windsurf config is user-global and not managed by Substrata.
  },
};
