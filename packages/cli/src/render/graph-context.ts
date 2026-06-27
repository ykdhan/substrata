/**
 * The graph-aware context renderer lives in `@substrata/search` so the CLI and
 * the MCP server render identical output. Re-exported here as the CLI's local
 * import point (commands/graph.ts) and for the renderer unit test.
 */
export { renderGraphContext } from '@substrata/search';
export type { GraphContextResult, GraphContextSource } from '@substrata/search';
