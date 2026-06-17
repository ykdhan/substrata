// Shared read-logging helper for the MCP tools (IMPROVEMENT_PLAN M2).
//
// Records each retrieval in the local access log so `substrata stats` can show
// whether memory is actually being read. Best-effort: never throws, so a logging
// failure can't break a tool call.

import { loadConfig } from '@substrata/core';
import { logAccess, type AccessEntry } from '@substrata/search';

export async function recordRead(cwd: string, entry: AccessEntry): Promise<void> {
  try {
    const config = await loadConfig(cwd);
    if (!config.telemetry.enabled) return;
    logAccess(cwd, entry, { storeQuery: config.telemetry.store_queries });
  } catch {
    // best-effort telemetry
  }
}
