import { listFootprints, slugify, supersedeFootprint, type Footprint } from '@substrata/core';
import type { Command } from 'commander';

import { out, requireConfig, resolveCwd } from '../util';

/**
 * `substrata gc` — housekeeping assistant (IMPROVEMENT_PLAN P3). Footprints are
 * append-only committed history, so this NEVER deletes anything. It reports
 * clutter and, with `--auto-supersede`, links duplicate footprints so retrieval
 * surfaces the current one:
 *
 *   - duplicate clusters: active footprints sharing a normalized title
 *   - already-superseded/deprecated footprints (resolved clutter)
 *   - stale footprints: completed + older than --stale-days (default 180)
 */

type GcOptions = {
  json?: boolean;
  autoSupersede?: boolean;
  staleDays?: string;
};

const DEFAULT_STALE_DAYS = 180;

/** Active = a footprint that still participates in retrieval. */
function isActive(fp: Footprint): boolean {
  return fp.frontmatter.status !== 'superseded' && fp.frontmatter.status !== 'deprecated';
}

/** Group active footprints by normalized (slugified) title; keep clusters >= 2. */
function duplicateClusters(footprints: Footprint[]): Footprint[][] {
  const groups = new Map<string, Footprint[]>();
  for (const fp of footprints) {
    if (!isActive(fp)) continue;
    const key = slugify(fp.title);
    const list = groups.get(key) ?? [];
    list.push(fp);
    groups.set(key, list);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    // Newest first within each cluster.
    .map((g) => g.sort((a, b) => b.frontmatter.created_at.localeCompare(a.frontmatter.created_at)));
}

export function registerGcCommand(program: Command): void {
  program
    .command('gc')
    .description('Report duplicate/stale footprints (and optionally link duplicates)')
    .option('--auto-supersede', 'Supersede older duplicates by the newest in each cluster')
    .option('--stale-days <n>', `Age (days) past which a completed footprint is "stale" (default ${DEFAULT_STALE_DAYS})`)
    .option('--json', 'Output JSON')
    .action(async (opts: GcOptions, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      await requireConfig(cwd);

      const footprints = await listFootprints(cwd);
      const clusters = duplicateClusters(footprints);
      const resolved = footprints.filter((fp) => !isActive(fp));

      const staleDaysNum = opts.staleDays ? Number(opts.staleDays) : DEFAULT_STALE_DAYS;
      const staleDays = Number.isFinite(staleDaysNum) ? staleDaysNum : DEFAULT_STALE_DAYS;
      const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();
      const stale = footprints.filter(
        (fp) =>
          isActive(fp) &&
          fp.frontmatter.status === 'completed' &&
          (fp.frontmatter.created_at ?? '') < cutoff,
      );

      // --auto-supersede: within each cluster, the newest keeps; older ones are
      // marked superseded_by the keeper.
      const actions: Array<{ keeper: string; superseded: string }> = [];
      if (opts.autoSupersede) {
        for (const cluster of clusters) {
          const [keeper, ...older] = cluster;
          for (const old of older) {
            await supersedeFootprint(cwd, old.frontmatter.id, keeper!.frontmatter.id);
            actions.push({ keeper: keeper!.frontmatter.id, superseded: old.frontmatter.id });
          }
        }
      }

      if (opts.json) {
        out.plain(
          JSON.stringify(
            {
              duplicateClusters: clusters.map((c) => ({
                title: c[0]!.title,
                ids: c.map((fp) => fp.frontmatter.id),
              })),
              resolved: resolved.length,
              stale: stale.map((fp) => ({ id: fp.frontmatter.id, title: fp.title })),
              superseded: actions,
            },
            null,
            2,
          ),
        );
        return;
      }

      if (clusters.length === 0 && stale.length === 0 && resolved.length === 0) {
        out.ok('No clutter found — footprints look tidy.');
        return;
      }

      if (clusters.length > 0) {
        out.plain(`Duplicate clusters (${clusters.length}):`);
        for (const c of clusters) {
          out.plain(`  "${c[0]!.title}"`);
          c.forEach((fp, i) => {
            const tag = i === 0 ? 'keep ' : 'dup  ';
            out.plain(`    ${tag} ${fp.frontmatter.id}  (${fp.frontmatter.created_at.slice(0, 10)})`);
          });
        }
        if (!opts.autoSupersede) {
          out.plain('  Run `substrata gc --auto-supersede` to link older duplicates to the newest.');
        }
      }

      if (actions.length > 0) {
        out.ok(`Superseded ${actions.length} duplicate footprint(s).`);
      }

      if (stale.length > 0) {
        out.plain('');
        out.plain(`Stale footprints (completed, older than ${staleDays} days): ${stale.length}`);
        for (const fp of stale.slice(0, 10)) {
          out.plain(`  ${fp.frontmatter.id}  ${fp.title}`);
        }
        if (stale.length > 10) out.plain(`  …and ${stale.length - 10} more`);
      }

      if (resolved.length > 0) {
        out.plain('');
        out.info(`${resolved.length} already superseded/deprecated footprint(s) (excluded from retrieval).`);
      }
    });
}
