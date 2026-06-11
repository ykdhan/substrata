import { randomBytes } from 'node:crypto';

/**
 * ID and filename generation for footprints. See plan §5.
 *
 *   id        : fp_<YYYYMMDD>_<slug_underscored>_<suffix>
 *   filename  : YYYY/MM/YYYY-MM-DD-<slug>-<suffix>.md
 */

/** Crockford-ish base32 alphabet without confusing chars (no i/l/o/u). */
const SUFFIX_ALPHABET = 'abcdefghjkmnpqrstvwxyz0123456789';
const SUFFIX_LENGTH = 6;

/**
 * Slugify a title into a lowercase, hyphenated slug suitable for filenames.
 * Non-alphanumeric runs become single hyphens; leading/trailing hyphens trimmed.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    // strip combining diacritical marks
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

/** Generate a random lowercase base32 suffix (default 6 chars). */
export function randomSuffix(length: number = SUFFIX_LENGTH): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SUFFIX_ALPHABET[bytes[i]! % SUFFIX_ALPHABET.length];
  }
  return out;
}

/**
 * Build a footprint id from a date and slug.
 * The slug is underscored (hyphens → underscores) per the id format.
 */
export function generateFootprintId(date: Date, slug: string, suffix?: string): string {
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const underscored = slug.replace(/-/g, '_');
  const sfx = suffix ?? randomSuffix();
  return `fp_${yyyy}${mm}${dd}_${underscored}_${sfx}`;
}

/** Build the repo-relative footprint filename `YYYY/MM/YYYY-MM-DD-<slug>-<suffix>.md`. */
export function buildFootprintFilename(date: Date, slug: string, suffix: string): string {
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${yyyy}-${mm}-${dd}-${slug}-${suffix}.md`;
}
