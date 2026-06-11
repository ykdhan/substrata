import type { ChangeResult } from '@substrata/core';

import { claudeCodeClient } from './claude-code';
import { cursorClient } from './cursor';
import { windsurfClient } from './windsurf';

/**
 * MCP client registry (plan §14). A small table so new clients can be added
 * without touching the wizard flow. Each client can detect whether it is present,
 * register the Substrata MCP server (idempotent, dry-runnable), and unregister.
 */

/** Spec for the Substrata MCP server entry written into client config. */
export type McpServerSpec = {
  /** Logical name of the server entry (the key in the client's config map). */
  name: string;
  command: string;
  args: string[];
};

export type McpClient = {
  /** Stable id: "claude" | "cursor" | "windsurf". */
  name: string;
  /** Human-friendly label for prompts. */
  label: string;
  detect(cwd: string): Promise<boolean>;
  register(cwd: string, spec: McpServerSpec, dry?: boolean): Promise<ChangeResult>;
  unregister(cwd: string, name: string): Promise<void>;
};

/** The default Substrata MCP server spec written into client configs. */
export const SUBSTRATA_MCP_SPEC: McpServerSpec = {
  name: 'substrata',
  command: 'npx',
  args: ['-y', 'substrata-cli', 'mcp'],
};

export const MCP_CLIENTS: McpClient[] = [claudeCodeClient, cursorClient, windsurfClient];

/** Look up a client by its stable id. */
export function getMcpClient(name: string): McpClient | undefined {
  return MCP_CLIENTS.find((c) => c.name === name);
}

/** Detect which registered clients are present in/around `cwd`. */
export async function detectMcpClients(cwd: string): Promise<McpClient[]> {
  const detected: McpClient[] = [];
  for (const client of MCP_CLIENTS) {
    if (await client.detect(cwd)) detected.push(client);
  }
  return detected;
}
