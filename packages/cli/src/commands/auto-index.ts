import { buildIndex, getIndexStatus } from '@substrata/index';

import { out } from '../util';

/**
 * Shared lazy-index helper for `search` and `context` (plan §8.3/§8.5). Rebuilds
 * a missing or stale index unless `--no-auto-index` was passed. A freshly cloned
 * repo (no index/) "just works" on the first query.
 */
export async function ensureFreshIndex(cwd: string, autoIndex: boolean): Promise<void> {
  const status = await getIndexStatus(cwd);
  if (status.state === 'fresh') return;

  if (!autoIndex) {
    out.info(
      status.state === 'missing'
        ? 'Index missing — run `substrata index` (auto-index disabled).'
        : `Index stale (${status.reason}) — run \`substrata index\` (auto-index disabled).`,
    );
    return;
  }

  await buildIndex(cwd);
}
