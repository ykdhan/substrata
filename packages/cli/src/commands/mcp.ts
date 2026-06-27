import type { Command } from 'commander';

import { CliError, out, resolveCwd } from '../util';
import { renderMcpConfig, type McpConfigClient } from '../mcp-clients/print-config';
import { detectMcpClients, getMcpClient, SUBSTRATA_MCP_SPEC } from '../mcp-clients/registry';

/**
 * `substrata mcp` — run the MCP server (plan §8.12). Dynamically imports
 * `@substrata/mcp-server` (built in parallel) and calls its documented contract:
 *   runMcpServer(options?: { cwd?: string }): Promise<void>
 *
 * Bare `substrata mcp` runs the server (this is what clients launch via
 * `npx -y substrata-cli mcp`). The `install` and `print-config` subcommands wire
 * the server into editors / print a copy-pasteable config for any MCP client
 * (graph-rag-implementation.md "Generic MCP Config").
 */

type McpServerModule = {
  runMcpServer: (options?: { cwd?: string }) => Promise<void>;
};

async function runServer(cwd: string): Promise<void> {
  let mod: McpServerModule;
  try {
    mod = (await import('@substrata/mcp-server')) as unknown as McpServerModule;
  } catch (err) {
    throw new CliError(`Failed to load @substrata/mcp-server: ${(err as Error).message}`);
  }
  if (typeof mod.runMcpServer !== 'function') {
    throw new CliError('@substrata/mcp-server does not export runMcpServer().');
  }
  await mod.runMcpServer({ cwd });
}

export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('Run the Substrata MCP server (stdio); see `mcp install` / `mcp print-config`')
    .action(async (_opts: unknown, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      await runServer(cwd);
    });

  mcp
    .command('install')
    .description('Register the Substrata MCP server with detected (or a named) editor')
    .option('--client <name>', 'Target a specific client (claude|cursor|windsurf|codex|gemini)')
    .option('--dry', 'Show what would change without writing')
    .action(async (opts: { client?: string; dry?: boolean }, command: Command) => {
      const cwd = resolveCwd(command.parent?.parent?.opts());

      const clients = opts.client
        ? [getMcpClient(opts.client)].filter((c): c is NonNullable<typeof c> => Boolean(c))
        : await detectMcpClients(cwd);

      if (opts.client && clients.length === 0) {
        throw new CliError(
          `Unknown MCP client: ${opts.client} (try claude, cursor, windsurf, codex, or gemini).`,
        );
      }
      if (clients.length === 0) {
        out.info(
          'No MCP clients detected. Run `substrata mcp print-config` for manual setup, or pass --client.',
        );
        return;
      }

      for (const client of clients) {
        const result = await client.register(cwd, SUBSTRATA_MCP_SPEC, opts.dry);
        const verb = opts.dry ? 'would ' : '';
        out.ok(`${client.label}: ${verb}${result.action} ${result.path} — ${result.description}`);
      }
    });

  mcp
    .command('print-config')
    .description('Print a copy-pasteable MCP server config for any client')
    .option('--client <name>', 'claude | cursor | codex | gemini | generic (default: generic)')
    .action(async (opts: { client?: string }) => {
      const requested = opts.client ?? 'generic';
      const valid: McpConfigClient[] = ['generic', 'claude', 'cursor', 'codex', 'gemini'];
      if (!valid.includes(requested as McpConfigClient)) {
        throw new CliError(`Unknown client: ${opts.client} (try ${valid.join(', ')}).`);
      }
      const { hint, body } = renderMcpConfig(requested as McpConfigClient, SUBSTRATA_MCP_SPEC);
      // Hint → stderr, config body → stdout, so `print-config > file` is clean.
      process.stderr.write(`${hint}\n`);
      out.plain(body);
    });
}
