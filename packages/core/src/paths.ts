import path from 'node:path';

/**
 * Path helpers for the .substrata directory.
 *
 * Repo-relative paths are always emitted with forward slashes so footprint
 * `file_path` values and config storage paths are stable across platforms.
 * Absolute on-disk paths use the platform separator (via node:path).
 */

export const SUBSTRATA_DIRNAME = '.substrata';

/** Convert any path to forward-slash form. */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Absolute path to the .substrata directory. */
export function substrataDir(cwd: string): string {
  return path.join(cwd, SUBSTRATA_DIRNAME);
}

/** Absolute path to config.yml. */
export function configPath(cwd: string): string {
  return path.join(substrataDir(cwd), 'config.yml');
}

/** Absolute path to the footprints directory. */
export function footprintsDir(cwd: string): string {
  return path.join(substrataDir(cwd), 'footprints');
}

/** Absolute path to the memory directory. */
export function memoryDir(cwd: string): string {
  return path.join(substrataDir(cwd), 'memory');
}

/** Absolute path to the templates directory. */
export function templatesDir(cwd: string): string {
  return path.join(substrataDir(cwd), 'templates');
}

/** Absolute path to the generated SQLite index. */
export function indexPath(cwd: string): string {
  return path.join(substrataDir(cwd), 'index', 'footprint.sqlite');
}

/**
 * Repo-relative footprint path of the form
 * `YYYY/MM/YYYY-MM-DD-<slug>-<suffix>.md` (forward slashes).
 */
export function footprintRelativePath(date: Date, slug: string, suffix: string): string {
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const filename = `${yyyy}-${mm}-${dd}-${slug}-${suffix}.md`;
  return `${yyyy}/${mm}/${filename}`;
}

/** Absolute on-disk path for a footprint, given its repo-relative path. */
export function footprintFilePath(cwd: string, relativePath: string): string {
  return path.join(footprintsDir(cwd), ...relativePath.split('/'));
}

/** Repo-relative (forward-slash) path from an absolute path. */
export function relativeToCwd(cwd: string, absolutePath: string): string {
  return toPosix(path.relative(cwd, absolutePath));
}
