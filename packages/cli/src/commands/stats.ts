import { listFootprints } from '@substrata/core';
import { readStats } from '@substrata/search';
import type { Command } from 'commander';

import { out, requireConfig, resolveCwd } from '../util';

/**
 * `substrata stats` — report memory usage from the local access log
 * (IMPROVEMENT_PLAN P1 / M2). Answers the question the original analysis had to
 * dig through transcripts for: is stored memory actually being read?
 *
 *   - read:write ratio over the period (reads = logged retrievals, writes =
 *     footprints created in the period)
 *   - reads broken down by op and by source (cli / mcp / hook)
 *   - most-referenced footprints, and how many were never referenced
 *
 * All data is local + gitignored; nothing is transmitted.
 */

type StatsOptions = {
  days?: string;
  json?: boolean;
  top?: string;
};

function ratio(reads: number, writes: number): string {
  if (writes === 0) return reads === 0 ? '0:0' : `${reads}:0`;
  return `${(reads / writes).toFixed(2)}:1`;
}

export function registerStatsCommand(program: Command): void {
  program
    .command('stats')
    .description('Report memory read/write usage from the local access log')
    .option('--days <n>', 'Only count activity in the trailing N days')
    .option('--top <n>', 'How many most-referenced footprints to show (default 5)')
    .option('--json', 'Output JSON')
    .action(async (opts: StatsOptions, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      await requireConfig(cwd);

      const sinceDays = opts.days ? Number(opts.days) : undefined;
      const top = opts.top ? Number(opts.top) : 5;
      const stats = readStats(cwd, {
        sinceDays: Number.isFinite(sinceDays) ? sinceDays : undefined,
      });

      const footprints = await listFootprints(cwd);
      const writes = stats.since
        ? footprints.filter((fp) => fp.frontmatter.created_at >= stats.since!).length
        : footprints.length;

      const titleById = new Map(footprints.map((fp) => [fp.frontmatter.id, fp.title]));
      const hitIds = new Set(stats.hitsById.map((h) => h.id));
      const neverReferenced = footprints.filter((fp) => !hitIds.has(fp.frontmatter.id));

      const mostReferenced = stats.hitsById
        .slice(0, Number.isFinite(top) ? top : 5)
        .map((h) => ({ id: h.id, hits: h.hits, title: titleById.get(h.id) ?? '(unknown)' }));

      if (opts.json) {
        out.plain(
          JSON.stringify(
            {
              since: stats.since,
              totalReads: stats.totalReads,
              totalWrites: writes,
              readWriteRatio: ratio(stats.totalReads, writes),
              byOp: stats.byOp,
              bySource: stats.bySource,
              totalFootprints: footprints.length,
              neverReferenced: neverReferenced.length,
              mostReferenced,
            },
            null,
            2,
          ),
        );
        return;
      }

      const period = stats.since ? `since ${stats.since.slice(0, 10)}` : 'all time';
      out.plain(`Substrata usage (${period}):`);
      out.plain('');
      out.plain(`  reads:writes      ${ratio(stats.totalReads, writes)}  (${stats.totalReads} reads / ${writes} writes)`);
      out.plain(`  footprints        ${footprints.length} total, ${neverReferenced.length} never referenced`);

      const byOp = Object.entries(stats.byOp);
      if (byOp.length > 0) {
        out.plain('');
        out.plain('  reads by op:');
        for (const [op, n] of byOp.sort((a, b) => b[1] - a[1])) out.plain(`    ${op.padEnd(10)} ${n}`);
      }
      const bySource = Object.entries(stats.bySource);
      if (bySource.length > 0) {
        out.plain('');
        out.plain('  reads by source:');
        for (const [src, n] of bySource.sort((a, b) => b[1] - a[1])) out.plain(`    ${src.padEnd(10)} ${n}`);
      }
      if (mostReferenced.length > 0) {
        out.plain('');
        out.plain('  most referenced:');
        for (const m of mostReferenced) out.plain(`    ${String(m.hits).padStart(3)}×  ${m.title}`);
      }
      if (stats.totalReads === 0) {
        out.plain('');
        out.info('No reads logged yet. Install the Claude Code hooks (`substrata hook claude`) so retrieval happens automatically.');
      }
    });
}
