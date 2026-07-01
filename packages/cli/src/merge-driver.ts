import { git } from './util';

/**
 * The committed shared index DB is binary and derived from the markdown source of
 * truth. Rather than forcing a manual fix on every conflicting pull, we register a
 * git merge driver that resolves a `.substrata/index/*.sqlite` conflict by
 * rebuilding the index from the (already text-merged) markdown.
 *
 * `.gitattributes` routes the files to `merge=substrata-rebuild` (see
 * editor-integrations/gitattributes.ts); this configures the driver itself, which
 * is repo-local git config and therefore can't be committed — `init`/`upgrade`
 * set it up for each clone in shared mode.
 */

export const MERGE_DRIVER_NAME = 'substrata-rebuild';

/** Driver command git runs on conflict. %A = ours/result temp file, %P = repo path. */
const MERGE_DRIVER_COMMAND = 'npx -y substrata-cli internal-merge-db %A %P';
const MERGE_DRIVER_DESC = 'Substrata: rebuild the derived index from committed markdown';

/**
 * Register the `substrata-rebuild` merge driver in the repo's git config.
 * Idempotent (git config overwrites). Best-effort: returns false outside a git
 * repo (or if git is unavailable) without throwing.
 */
export async function configureMergeDriver(cwd: string): Promise<boolean> {
  const name = await git(cwd, ['config', `merge.${MERGE_DRIVER_NAME}.name`, MERGE_DRIVER_DESC]);
  const driver = await git(cwd, [
    'config',
    `merge.${MERGE_DRIVER_NAME}.driver`,
    MERGE_DRIVER_COMMAND,
  ]);
  return name !== null && driver !== null;
}
