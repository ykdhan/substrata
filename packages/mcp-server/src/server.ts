// Substrata MCP server. See plan §9 + §15 Phase 6.
//
// IMPORTANT: stdout is owned by the stdio transport's JSON-RPC framing. Never
// write to stdout directly from this process; all diagnostics go to stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { addInputShape, runAdd, type AddInput } from './tools/add';
import { contextInputShape, runContext, type ContextInput } from './tools/context';
import { listRecentInputShape, runListRecent, type ListRecentInput } from './tools/list-recent';
import {
  relatedToFileInputShape,
  runRelatedToFile,
  type RelatedToFileInput,
} from './tools/related-to-file';
import { errorResult, jsonResult } from './tools/result';
import { runSearch, searchInputShape, type SearchInput } from './tools/search';

export type CreateServerOptions = {
  /** Repo root containing `.substrata/`. Defaults to process.cwd(). */
  cwd?: string;
};

/**
 * Build a fully-configured Substrata MCP server with all five tools registered.
 * The returned server is transport-agnostic; connect it to any transport.
 */
export function createSubstrataMcpServer(options: CreateServerOptions = {}): McpServer {
  const cwd = options.cwd ?? process.cwd();

  const server = new McpServer({
    name: 'substrata',
    version: '0.1.0',
  });

  server.registerTool(
    'substrata_search',
    {
      title: 'Search Substrata memory',
      description:
        'Full-text search over footprints and curated memory. Returns ranked SearchResult records.',
      inputSchema: searchInputShape,
    },
    async (input: SearchInput) => jsonResult(await runSearch(input, cwd)),
  );

  server.registerTool(
    'substrata_context',
    {
      title: 'Get Substrata context for a task',
      description:
        'Return concise, source-linked memory for an agent before it begins work. Excludes superseded footprints and fits a token budget.',
      inputSchema: contextInputShape,
    },
    async (input: ContextInput) => jsonResult(await runContext(input, cwd)),
  );

  server.registerTool(
    'substrata_add',
    {
      title: 'Add a Substrata footprint',
      description:
        'Record a footprint (decision/implementation/learning). Runs a secret scan and refuses on detection.',
      inputSchema: addInputShape,
    },
    async (input: AddInput) => {
      const outcome = await runAdd(input, cwd);
      if (!outcome.ok) {
        const detail = outcome.secrets.map((s) => `${s.name} at line ${s.line}`).join(', ');
        return errorResult(
          `Refusing to write footprint: ${outcome.secrets.length} potential secret(s) detected: ${detail}. Redact these before retrying (footprints are committed).`,
          { secrets: outcome.secrets },
        );
      }
      return jsonResult({ id: outcome.id, filePath: outcome.filePath });
    },
  );

  server.registerTool(
    'substrata_related_to_file',
    {
      title: 'Find Substrata records related to a file',
      description: 'Return footprints/memory that reference a given file path.',
      inputSchema: relatedToFileInputShape,
    },
    async (input: RelatedToFileInput) => jsonResult(await runRelatedToFile(input, cwd)),
  );

  server.registerTool(
    'substrata_list_recent',
    {
      title: 'List recent Substrata footprints',
      description: 'List the most recent footprints, optionally filtered by tag.',
      inputSchema: listRecentInputShape,
    },
    async (input: ListRecentInput) => jsonResult(await runListRecent(input, cwd)),
  );

  return server;
}

/**
 * Run the Substrata MCP server over stdio. Diagnostics are written to stderr so
 * they never corrupt the stdout JSON-RPC stream.
 */
export async function runMcpServer(options: CreateServerOptions = {}): Promise<void> {
  const server = createSubstrataMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('substrata MCP server running on stdio\n');
}
