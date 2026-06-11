import type { Command } from 'commander';

import { CliError, resolveCwd } from '../util';

/**
 * `substrata mcp` — run the MCP server (plan §8.12). Dynamically imports
 * `@substrata/mcp-server` (built in parallel) and calls its documented contract:
 *   runMcpServer(options?: { cwd?: string }): Promise<void>
 */

type McpServerModule = {
  runMcpServer: (options?: { cwd?: string }) => Promise<void>;
};

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Run the Substrata MCP server (stdio)')
    .action(async (_opts: unknown, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
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
    });
}
