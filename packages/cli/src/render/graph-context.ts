/**
 * The graph-aware context renderer lives in `@substrata/index` so the CLI and
 * the MCP server render identical output. Re-exported here as the CLI's local
 * import point (commands/graph.ts) and for the renderer unit test.
 */
export { renderGraphContext } from '@substrata/index';
export type { GraphContextResult, GraphContextSource } from '@substrata/index';
