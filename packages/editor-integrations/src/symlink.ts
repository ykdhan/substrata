import { lstatSync } from 'node:fs';

/**
 * Setup writers refuse to write through symlinks: a repo could ship e.g. an
 * `AGENTS.md -> ~/.ssh/config` link and turn a marker-block upsert into a
 * clobber of a file outside the repo. Shell-rc writes are exempt by design —
 * dotfiles are commonly symlinked and the user explicitly opts into that write.
 */
export function isSymlink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}
