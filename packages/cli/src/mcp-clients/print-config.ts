import type { McpServerSpec } from './registry';

/**
 * Editor-agnostic MCP config printer (graph-rag-implementation.md "Generic MCP
 * Config"). Substrata is not editor-specific: any agent that speaks MCP can run
 * the server with the SAME `npx -y substrata-cli mcp` command. This renders a
 * copy-pasteable config snippet for the common clients (and a generic fallback)
 * so users on Codex / Gemini CLI / any MCP client can wire it up by hand.
 */

export type McpConfigClient = 'generic' | 'claude' | 'cursor' | 'codex' | 'gemini';

export const MCP_CONFIG_CLIENTS: McpConfigClient[] = [
  'generic',
  'claude',
  'cursor',
  'codex',
  'gemini',
];

/** Where each client expects the snippet to be placed (printed as guidance). */
const PLACEMENT: Record<McpConfigClient, string> = {
  generic: 'Add to your MCP client config under the `mcpServers` map:',
  claude: 'Add to `.mcp.json` (project) or `~/.claude.json` (global):',
  cursor: 'Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):',
  codex: 'Add to `~/.codex/config.toml`:',
  gemini: 'Add to `~/.gemini/settings.json` (or `.gemini/settings.json`) under `mcpServers`:',
};

function jsonConfig(spec: McpServerSpec): string {
  return JSON.stringify(
    { mcpServers: { [spec.name]: { command: spec.command, args: spec.args } } },
    null,
    2,
  );
}

function tomlConfig(spec: McpServerSpec): string {
  const args = spec.args.map((a) => JSON.stringify(a)).join(', ');
  return [
    `[mcp_servers.${spec.name}]`,
    `command = ${JSON.stringify(spec.command)}`,
    `args = [${args}]`,
  ].join('\n');
}

/**
 * Render the MCP server config for a client as `{ hint, body }`. The command
 * prints `hint` to stderr and `body` to stdout, so `print-config > file` yields
 * a clean config file. Codex uses TOML; every other client uses the standard
 * `mcpServers` JSON shape (which also covers Gemini CLI and generic clients).
 */
export function renderMcpConfig(
  client: McpConfigClient,
  spec: McpServerSpec,
): { hint: string; body: string } {
  const body = client === 'codex' ? tomlConfig(spec) : jsonConfig(spec);
  return { hint: PLACEMENT[client], body };
}
