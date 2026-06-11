import { readFile, writeFile } from 'node:fs/promises';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { NotFoundError } from './errors';
import { findFootprintById } from './footprint';
import type { FootprintRelated } from './types';

/**
 * Supersede relationship editing. See plan §5/§8.9.
 *
 * Edits ONLY the YAML frontmatter of both files (old + new); the markdown body
 * is preserved byte-for-byte. Old footprint gets status=superseded and
 * superseded_by += newId; new footprint gets supersedes += oldId.
 */

const FRONTMATTER_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/;

function addUnique(list: string[] | undefined, value: string): string[] {
  const arr = list ? [...list] : [];
  if (!arr.includes(value)) arr.push(value);
  return arr;
}

/**
 * Rewrite a footprint file's frontmatter via `mutate`, preserving the exact
 * body bytes and the original frontmatter fences/newlines.
 */
async function editFrontmatter(
  filePath: string,
  mutate: (fm: Record<string, unknown>) => void,
): Promise<void> {
  const raw = await readFile(filePath, 'utf8');
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    throw new NotFoundError(`Footprint at ${filePath} has no parseable frontmatter`);
  }
  const [, open, yamlText, close, body] = match;
  const parsed = parseYaml(yamlText!) as Record<string, unknown>;
  mutate(parsed);
  const newYaml = stringifyYaml(parsed, { lineWidth: 0 }).replace(/\n$/, '');
  const next = `${open}${newYaml}${close}${body}`;
  await writeFile(filePath, next, 'utf8');
}

/**
 * Mark `oldId` as superseded by `newId`. Edits frontmatter only on both files.
 * Throws NotFoundError if either id cannot be located.
 */
export async function supersedeFootprint(cwd: string, oldId: string, newId: string): Promise<void> {
  const oldFp = await findFootprintById(cwd, oldId);
  if (!oldFp) throw new NotFoundError(`Footprint not found: ${oldId}`);
  const newFp = await findFootprintById(cwd, newId);
  if (!newFp) throw new NotFoundError(`Footprint not found: ${newId}`);

  await editFrontmatter(oldFp.filePath, (fm) => {
    fm.status = 'superseded';
    const related = (fm.related as FootprintRelated | undefined) ?? {};
    related.superseded_by = addUnique(related.superseded_by, newId);
    fm.related = related;
  });

  await editFrontmatter(newFp.filePath, (fm) => {
    const related = (fm.related as FootprintRelated | undefined) ?? {};
    related.supersedes = addUnique(related.supersedes, oldId);
    fm.related = related;
  });
}
